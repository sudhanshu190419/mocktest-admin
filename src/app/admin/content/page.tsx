'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useContentList } from '@/hooks/content/useContent';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatsCardSkeleton } from '@/components/ui/LoadingSkeleton';

export default function AdminContentDashboardPage() {
  const { instituteId } = useAuth();

  const { data: contentData, isLoading } = useContentList(
    instituteId ? { instituteId } : undefined,
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page: 1, pageSize: 1000 },
  );

  const stats = useMemo(() => {
    if (!contentData?.data) {
      return { total: 0, draft: 0, pending_review: 0, approved: 0, rejected: 0, archived: 0 };
    }
    const items = contentData.data;
    return {
      total: items.length,
      draft: items.filter((c) => c.status === 'draft').length,
      pending_review: items.filter((c) => c.status === 'pending_review').length,
      approved: items.filter((c) => c.status === 'approved').length,
      rejected: items.filter((c) => c.status === 'rejected').length,
      archived: items.filter((c) => c.status === 'archived').length,
    };
  }, [contentData]);

  const statCards = [
    { label: 'Total Content', value: stats.total, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
    { label: 'Pending Review', value: stats.pending_review, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
    { label: 'Approved', value: stats.approved, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
    { label: 'Rejected', value: stats.rejected, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800' },
    { label: 'Draft', value: stats.draft, color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200 dark:border-gray-700' },
    { label: 'Archived', value: stats.archived, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800' },
  ];

  const quickActions = [
    {
      title: 'Upload Content',
      description: 'Upload study material, lecture videos, and notes directly',
      href: '/admin/content/create',
      icon: '📤',
      color: 'bg-emerald-600',
    },
    {
      title: 'Review Content',
      description: 'Review and approve/reject content submitted by teachers',
      href: '/admin/content/review',
      icon: '✅',
      color: 'bg-amber-600',
    },
    {
      title: 'All Content',
      description: 'View all content across the institute',
      href: '/admin/content/review?status=approved',
      icon: '📚',
      color: 'bg-blue-600',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Content Management"
        description="Review and manage teacher-uploaded content"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Content' },
        ]}
      />

      {isLoading ? (
        <StatsCardSkeleton count={6} />
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
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
