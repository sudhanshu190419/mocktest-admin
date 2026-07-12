'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRecentActivity } from '@/hooks/analytics/useAnalytics';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { getScoreColorClass } from '@/utils/mockResults';

const ACTIVITY_ICONS: Record<string, { icon: string; bg: string }> = {
  attempt_completed: {
    icon: '✓',
    bg: 'bg-emerald-500',
  },
  attempt_started: {
    icon: '▶',
    bg: 'bg-blue-500',
  },
  result_released: {
    icon: '📊',
    bg: 'bg-purple-500',
  },
};

const ACTIVITY_LABELS: Record<string, string> = {
  attempt_completed: 'Test Submitted',
  attempt_started: 'Test Started',
  result_released: 'Result Published',
};

export default function StudentActivityPage() {
  const params = useParams();
  const studentId = params.id as string;

  const { data: activity, isLoading, error } = useRecentActivity(studentId, 50);

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Activity"
          breadcrumbs={[
            { label: 'Students', href: '/teacher/students' },
            { label: 'Profile' },
            { label: 'Activity' },
          ]}
        />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader
          title="Activity"
          breadcrumbs={[
            { label: 'Students', href: '/teacher/students' },
            { label: 'Profile' },
            { label: 'Activity' },
          ]}
        />
        <EmptyState
          title="Failed to load activity"
          description={(error as Error)?.message ?? 'An error occurred.'}
        />
      </div>
    );
  }

  // Group by date
  const activityItems = activity ?? [];
  const grouped = activityItems.reduce<Record<string, typeof activityItems>>((acc, item) => {
    const dateKey = new Date(item.timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Recent student activity timeline"
        breadcrumbs={[
          { label: 'Students', href: '/teacher/students' },
          { label: 'Profile' },
          { label: 'Activity' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/students/${studentId}/analytics`}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              Analytics
            </Link>
            <Link
              href={`/teacher/students/${studentId}/results`}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Results
            </Link>
          </div>
        }
      />

      {!activity || activity.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Student activity such as test attempts and results will appear here."
        />
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {date}
              </h3>
              <div className="space-y-3">
                {items.map((item, i) => {
                  const meta = ACTIVITY_ICONS[item.type] ?? {
                    icon: '•',
                    bg: 'bg-gray-500',
                  };
                  const label = ACTIVITY_LABELS[item.type] ?? item.type;

                  return (
                    <div
                      key={`${item.referenceId}-${i}`}
                      className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
                    >
                      {/* Icon */}
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm text-white shadow-sm ${meta.bg}`}
                      >
                        {meta.icon}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {label}
                        </p>
                        <p className="text-xs text-gray-500">{item.description}</p>
                      </div>

                      {/* Score / Timestamp */}
                      <div className="flex-shrink-0 text-right">
                        {item.score != null && (
                          <p
                            className={`text-sm font-bold ${
                              item.maxScore ? getScoreColorClass((item.score / item.maxScore) * 100) : 'text-gray-600'
                            }`}
                          >
                            {item.score}{item.maxScore ? `/${item.maxScore}` : ''}
                          </p>
                        )}
                        <p className="text-[10px] text-gray-400">
                          {new Date(item.timestamp).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
