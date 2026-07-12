'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getTeacherActivity } from '@/services/profileService';
import { PageHeader } from '@/components/ui/PageHeader';
import { ActivityTimeline } from '@/components/profile/ActivityTimeline';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { StatsCardSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { ActivityEvent } from '@/types/profile';
import type { AnalyticsFilters } from '@/types/analytics-extended';

export default function ActivityPage() {
  const { teacherProfile, user } = useAuth();
  const teacherId = teacherProfile?.id ?? user?.id;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const fetchActivity = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError(null);
    const result = await getTeacherActivity(teacherId);
    if (result.success) {
      setEvents(result.data ?? []);
    } else {
      setError(result.error ?? 'Failed to load activity.');
    }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Filter events by search term
  const filteredEvents = events.filter((ev) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      ev.title.toLowerCase().includes(q) ||
      ev.description.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account Activity"
        description="Track your recent actions, changes, and system activity"
        actions={
          <button
            type="button"
            onClick={fetchActivity}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label="Refresh activity"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        }
      />

      {/* Search */}
      <div className="relative max-w-md">
        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search activity..."
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-600"
          aria-label="Search activity"
        />
      </div>

      <AnalyticsFilter filters={filters} onChange={setFilters} showExport />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Activity count */}
      {!loading && filteredEvents.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Showing {filteredEvents.length} of {events.length} events
          {search && ` (filtered from ${events.length})`}
        </p>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <StatsCardSkeleton count={1} />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <EmptyState
            title={search ? 'No matching activity' : 'No activity yet'}
            description={search ? 'Try a different search term.' : 'Your account activity will appear here as you use the platform.'}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <ActivityTimeline events={filteredEvents} />
        </div>
      )}
    </div>
  );
}
