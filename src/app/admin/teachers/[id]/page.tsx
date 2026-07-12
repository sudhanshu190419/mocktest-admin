'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTeacherDetail } from '@/hooks/admin/useTeacherLifecycle';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import {
  User,
  Envelope,
  Phone,
  IdentificationCard,
  Buildings,
  CalendarBlank,
  Clock,
  Question,
  Exam,
  UsersThree,
  Books,
  CheckCircle,
  Prohibit,
  Power,
  Hourglass,
  XCircle,
} from '@phosphor-icons/react';
import type { AccountStatus } from '@/types/auth';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Not Approved',
  suspended: 'Suspended',
  inactive: 'Inactive',
};

const STATUS_TIMELINE_ICONS: Record<string, React.ReactNode> = {
  pending: <Hourglass size={18} weight="duotone" />,
  approved: <CheckCircle size={18} weight="duotone" />,
  rejected: <XCircle size={18} weight="duotone" />,
  suspended: <Prohibit size={18} weight="duotone" />,
  inactive: <Power size={18} weight="duotone" />,
};

const STATUS_TIMELINE_COLORS: Record<string, { bg: string; dot: string; border: string; icon: string }> = {
  pending: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    dot: 'bg-amber-500',
    border: 'border-amber-200 dark:border-amber-800',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  approved: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200 dark:border-emerald-800',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  rejected: {
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    dot: 'bg-rose-500',
    border: 'border-rose-200 dark:border-rose-800',
    icon: 'text-rose-600 dark:text-rose-400',
  },
  suspended: {
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    dot: 'bg-indigo-500',
    border: 'border-indigo-200 dark:border-indigo-800',
    icon: 'text-indigo-600 dark:text-indigo-400',
  },
  inactive: {
    bg: 'bg-gray-50 dark:bg-gray-800/30',
    dot: 'bg-gray-400',
    border: 'border-gray-200 dark:border-gray-700',
    icon: 'text-gray-500 dark:text-gray-400',
  },
};

const FALLBACK_TIMELINE_COLOR = {
  bg: 'bg-gray-50 dark:bg-gray-800/30',
  dot: 'bg-gray-400',
  border: 'border-gray-200 dark:border-gray-700',
  icon: 'text-gray-500 dark:text-gray-400',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton
// ═══════════════════════════════════════════════════════════════════════════

function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Profile skeleton */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-5">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </div>

      {/* Two-column skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-4 h-4 w-32" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-4 h-4 w-24" />
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Info Row Component
// ═══════════════════════════════════════════════════════════════════════════

function InfoRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | React.ReactNode;
  href?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        {href ? (
          <Link
            href={href}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {value}
          </Link>
        ) : (
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Stat Card Component
// ═══════════════════════════════════════════════════════════════════════════

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
    amber: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
    purple: 'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorMap[color] ?? colorMap.blue}`}>
      <div className="mb-2">{icon}</div>
      <p className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p className="text-[11px] font-medium uppercase tracking-wider opacity-70 mt-0.5">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Status Timeline Component
// ═══════════════════════════════════════════════════════════════════════════

function StatusTimeline({ currentStatus }: { currentStatus: AccountStatus }) {
  // The timeline shows: Registered → Current Status
  // Future phase: add transition events (Approved, Rejected, Suspended, Activated) with timestamps
  const timelineItems = [
    {
      key: 'registered',
      label: 'Registered',
      icon: <User size={18} weight="duotone" />,
      color: FALLBACK_TIMELINE_COLOR,
      isActive: true,
    },
    {
      key: currentStatus,
      label: ACCOUNT_STATUS_LABELS[currentStatus],
      icon: STATUS_TIMELINE_ICONS[currentStatus] ?? <User size={18} weight="duotone" />,
      color: STATUS_TIMELINE_COLORS[currentStatus] ?? FALLBACK_TIMELINE_COLOR,
      isActive: true,
    },
  ];

  // Placeholder slots for future transitions (Approved, Rejected, Suspended, Activated)
  // These will be populated with timestamps when the admin performs those actions.
  // The design is ready — just add items to the timelineItems array.

  return (
    <div className="relative space-y-0">
      {timelineItems.map((item, idx) => (
        <div key={item.key} className="flex gap-4">
          {/* Timeline line + dot */}
          <div className="flex flex-col items-center">
            <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 ${item.color.border} ${item.color.bg}`}>
              <span className={item.color.icon}>{item.icon}</span>
            </div>
            {idx < timelineItems.length - 1 && (
              <div className="mt-1 h-8 w-px bg-gray-200 dark:bg-gray-700" />
            )}
          </div>

          {/* Content */}
          <div className="pb-6 pt-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {item.label}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {item.key === 'registered'
                ? 'Account was created via registration'
                : 'Current account status'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function TeacherDetailPage() {
  const params = useParams();
  const profileId = params.id as string;

  const { data: teacher, isLoading, isError, error, refetch } = useTeacherDetail(profileId);

  // ═════════════════════════════════════════════════════════════════════
  //  Loading State
  // ═════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Teacher Details"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Teacher Management', href: '/admin/teachers' },
            { label: 'Loading...' },
          ]}
        />
        <DetailPageSkeleton />
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Error State
  // ═════════════════════════════════════════════════════════════════════
  if (isError || !teacher) {
    return (
      <div>
        <PageHeader
          title="Teacher Details"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Teacher Management', href: '/admin/teachers' },
            { label: 'Error' },
          ]}
        />
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <XCircle size={28} weight="duotone" className="text-red-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-red-800 dark:text-red-300">
                Failed to load teacher details
              </p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'The teacher could not be found or an error occurred.'}
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/admin/teachers"
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-900 dark:text-red-400"
              >
                ← Back to Teacher List
              </Link>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Render — Teacher Data Loaded
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title={teacher.name}
        description={`Teacher Profile · ${teacher.department ?? 'No Department'}`}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Teacher Management', href: '/admin/teachers' },
          { label: teacher.name },
        ]}
        actions={
          <Link
            href="/admin/teachers"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            ← Back to List
          </Link>
        }
      />

      {/* ════════════════════════════════════════════════════════════════
          Profile Card
         ════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-6">
          {/* Avatar */}
          <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xl font-bold text-white shadow-sm">
            {teacher.avatarUrl ? (
              <img
                src={teacher.avatarUrl}
                alt={teacher.name}
                className="h-20 w-20 rounded-full object-cover"
              />
            ) : (
              getInitials(teacher.name)
            )}
          </div>

          {/* Name + Status */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">
                {teacher.name}
              </h2>
              <StatusBadge status={teacher.accountStatus} showDot={true} />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {teacher.designation ?? 'Faculty'} · {teacher.department ?? 'No Department'}
            </p>
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-4 sm:flex-shrink-0">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{teacher.questionCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Questions</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{teacher.mockTestCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Tests</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{teacher.batchCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Batches</p>
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Two-Column Layout
         ════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ─── LEFT COLUMN (2/3) ────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">

          {/* Profile Information */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Profile Information
            </h3>
            <p className="mb-3 text-xs text-gray-500">Basic contact and identity details</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<User size={18} />}
                label="Full Name"
                value={teacher.name}
              />
              <InfoRow
                icon={<Phone size={18} />}
                label="Phone"
                value={teacher.phone ?? 'Not provided'}
              />
              <InfoRow
                icon={<Envelope size={18} />}
                label="Email"
                value={teacher.email ?? 'Not provided'}
              />
              <InfoRow
                icon={<IdentificationCard size={18} />}
                label="Faculty ID"
                value={teacher.teacherId ? (
                  <span className="font-mono text-xs">{teacher.teacherId}</span>
                ) : 'Not available'}
              />
              <InfoRow
                icon={<Buildings size={18} />}
                label="Department"
                value={teacher.department ?? 'Not specified'}
              />
              <InfoRow
                icon={<Buildings size={18} />}
                label="Designation"
                value={teacher.designation ?? 'Faculty'}
              />
              <InfoRow
                icon={<Books size={18} />}
                label="Institute"
                value={teacher.instituteName ?? teacher.instituteId ?? '—'}
              />
            </div>
          </div>

          {/* Statistics */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Statistics
            </h3>
            <p className="mb-4 text-xs text-gray-500">Content and activity overview</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                icon={<Question size={22} weight="duotone" />}
                label="Questions Created"
                value={teacher.questionCount}
                color="blue"
              />
              <StatCard
                icon={<Exam size={22} weight="duotone" />}
                label="Mock Tests"
                value={teacher.mockTestCount}
                color="purple"
              />
              <StatCard
                icon={<UsersThree size={22} weight="duotone" />}
                label="Batches Assigned"
                value={teacher.batchCount}
                color="emerald"
              />
              <StatCard
                icon={<UsersThree size={22} weight="duotone" />}
                label="Students"
                value="—"
                color="gray"
              />
            </div>
          </div>

          {/* Recent Activity */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Recent Activity
            </h3>
            <p className="mb-4 text-xs text-gray-500">Latest teacher actions</p>
            {teacher.lastActivityAt ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-900/10">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Clock size={18} weight="duotone" className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Last activity recorded
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatDateTime(teacher.lastActivityAt)}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Clock size={32} weight="thin" />}
                title="No activity yet"
                description="Activity will appear once the teacher creates content or takes actions."
              />
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN (1/3) ────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Account Information */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Account
            </h3>
            <p className="mb-3 text-xs text-gray-500">Authentication and lifecycle</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<User size={18} />}
                label="Role"
                value={
                  <StatusBadge status="teacher" showDot={false} />
                }
              />
              <InfoRow
                icon={<CheckCircle size={18} />}
                label="Account Status"
                value={
                  <StatusBadge status={teacher.accountStatus} showDot={true} />
                }
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Joined Date"
                value={formatDate(teacher.createdAt)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Last Updated"
                value={teacher.updatedAt ? formatDateTime(teacher.updatedAt) : '—'}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Last Activity"
                value={teacher.lastActivityAt ? formatDateTime(teacher.lastActivityAt) : 'No activity'}
              />
            </div>
          </div>

          {/* Status Timeline */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Status Timeline
            </h3>
            <p className="mb-4 text-xs text-gray-500">Account lifecycle progression</p>
            <StatusTimeline currentStatus={teacher.accountStatus} />

            {/* Placeholder for future transitions */}
            <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-3 text-center dark:border-gray-700 dark:bg-gray-800/20">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Status transition history will appear here when admin actions are performed.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
