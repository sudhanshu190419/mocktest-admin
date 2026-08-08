'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useSubscriptionDetail,
  useSubscriptionPayments,
  useSubscriptionHistory,
} from '@/hooks/admin/useSubscriptionAdmin';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import {
  CreditCard,
  Clock,
  Warning,
  Copy,
  ArrowLeft,
} from '@phosphor-icons/react';
import type {
  SubscriptionPaymentItem,
  SubscriptionHistoryItem,
} from '@/services/admin/subscriptionAdminService';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number | null | undefined, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount ?? 0);
}

function getBillingCycleLabel(cycle: string | null | undefined): string {
  switch (cycle) {
    case 'monthly': return 'Monthly';
    case 'quarterly': return 'Quarterly';
    case 'half_yearly': return 'Half-Yearly';
    case 'yearly': return 'Yearly';
    case 'lifetime': return 'Lifetime';
    case 'custom': return 'Custom';
    default: return cycle ?? '—';
  }
}

function getChangeReasonLabel(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════════════════
//  Summary Field
// ═══════════════════════════════════════════════════════════════════════════

function SummaryField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className={`mt-1 text-sm text-gray-900 dark:text-gray-100 ${mono ? 'font-mono' : 'font-medium'}`}>
        {value ?? '—'}
      </p>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();

  const {
    data: subscription,
    isLoading,
    isError,
    error,
  } = useSubscriptionDetail(id);

  const {
    data: payments,
    isLoading: paymentsLoading,
    isError: paymentsError,
  } = useSubscriptionPayments(id);

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
  } = useSubscriptionHistory(id);

  const paymentColumns: Column<SubscriptionPaymentItem>[] = useMemo(() => [
    {
      key: 'paymentId',
      header: 'Payment ID',
      render: (item) => (
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
          {item.paymentId.slice(0, 8)}...
        </span>
      ),
    },
    {
      key: 'gatewayPaymentId',
      header: 'Razorpay ID',
      render: (item) => (
        <div className="min-w-0 max-w-[130px]">
          {item.gatewayPaymentId ? (
            <span className="block truncate font-mono text-[11px] text-gray-500">
              {item.gatewayPaymentId}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
          {item.gatewayOrderId && (
            <p className="truncate font-mono text-[10px] text-gray-400">
              Order: {item.gatewayOrderId}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (item) => (
        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
          {formatCurrency(item.amount, item.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <StatusBadge status={item.status} showDot={true} />,
    },
    {
      key: 'flags',
      header: 'Integrity Flags',
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          {item.duplicateOfOrderId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">
              <Copy size={10} weight="bold" />
              Duplicate{item.duplicateKind ? ` (${item.duplicateKind})` : ''}
            </span>
          )}
          {item.flaggedForRefund && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              <Warning size={10} weight="bold" />
              Refund Flag
            </span>
          )}
          {!item.duplicateOfOrderId && !item.flaggedForRefund && (
            <span className="text-xs text-gray-400">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'paidAt',
      header: 'Paid At',
      render: (item) => <span className="text-xs text-gray-500">{formatDateTime(item.paidAt)}</span>,
    },
  ], []);

  // ── Loading ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Subscription Detail"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Commerce', href: '/admin/commerce' },
            { label: 'Subscriptions', href: '/admin/commerce/subscriptions' },
            { label: 'Loading...' },
          ]}
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
              <Skeleton className="mb-2 h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <Skeleton className="mb-3 h-4 w-40" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  // ── Error / Not Found ───────────────────────────────────────────────
  if (isError || !subscription) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Subscription Detail"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Commerce', href: '/admin/commerce' },
            { label: 'Subscriptions', href: '/admin/commerce/subscriptions' },
            { label: 'Detail' },
          ]}
        />
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            {isError
              ? `Failed to load subscription: ${error instanceof Error ? error.message : 'Unknown error'}`
              : 'Subscription not found.'}
          </p>
          <Link
            href="/admin/commerce/subscriptions"
            className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            <ArrowLeft size={14} />
            Back to Subscriptions
          </Link>
        </div>
      </div>
    );
  }

  const totalPaid = (payments ?? [])
    .filter((p) => p.status === 'captured')
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={subscription.planName ?? 'Subscription Detail'}
        description={
          subscription.courseTitle
            ? `${subscription.courseTitle} · ${getBillingCycleLabel(subscription.billingCycle)} plan`
            : `${getBillingCycleLabel(subscription.billingCycle)} plan`
        }
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Commerce', href: '/admin/commerce' },
          { label: 'Subscriptions', href: '/admin/commerce/subscriptions' },
          { label: subscription.subscriptionId.slice(0, 8) },
        ]}
        actions={
          <Link
            href="/admin/commerce/subscriptions"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ArrowLeft size={14} />
            Back
          </Link>
        }
      />

      {/* ════════════════════════════════════════════════════════════════════
          Summary
         ════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryField label="Student" value={subscription.studentName ?? '—'} />
        <SummaryField label="Phone" value={subscription.studentPhone ?? '—'} mono />
        <SummaryField label="Course" value={subscription.courseTitle ?? '—'} />
        <SummaryField
          label="Status"
          value={<StatusBadge status={subscription.status} showDot={true} />}
        />
        <SummaryField label="Billing Cycle" value={getBillingCycleLabel(subscription.billingCycle)} />
        <SummaryField
          label="Plan Price"
          value={formatCurrency(subscription.planPrice, subscription.planCurrency)}
        />
        <SummaryField label="Start Date" value={formatDate(subscription.startDate)} />
        <SummaryField label="End Date" value={formatDate(subscription.endDate)} />
        <SummaryField label="Grace End" value={formatDate(subscription.graceEndDate)} />
        <SummaryField label="Content Access Until" value={formatDate(subscription.contentAccessEndDate)} />
        <SummaryField label="Auto-Renew" value={subscription.isAutoRenew ? 'Yes' : 'No'} />
        <SummaryField label="Trial" value={subscription.isTrial ? 'Yes' : 'No'} />
        <SummaryField label="Subscription ID" value={subscription.subscriptionId} mono />
        <SummaryField label="Order Ref" value={subscription.orderId ?? '—'} mono />
        <SummaryField label="Created" value={formatDateTime(subscription.createdAt)} />
        <SummaryField label="Updated" value={formatDateTime(subscription.updatedAt)} />
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          Payment History
         ════════════════════════════════════════════════════════════════════ */}
      <DetailSection title="Payment History">
        {paymentsError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            Failed to load payment history.
          </div>
        )}

        <div className="mb-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <CreditCard size={14} weight="duotone" />
          <span>
            Total captured across {payments?.filter((p) => p.status === 'captured').length ?? 0} payment
            {(payments?.filter((p) => p.status === 'captured').length ?? 0) === 1 ? '' : 's'}:{' '}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(totalPaid, subscription.planCurrency)}
            </span>
          </span>
        </div>

        <DataTable
          columns={paymentColumns}
          data={payments ?? []}
          keyExtractor={(item) => item.paymentId}
          isLoading={paymentsLoading}
          emptyState={
            <EmptyState
              icon={<CreditCard size={40} weight="thin" />}
              title="No payments recorded"
              description="Payment attempts linked to this plan will appear here."
            />
          }
        />
      </DetailSection>

      {/* ════════════════════════════════════════════════════════════════════
          Audit History
         ════════════════════════════════════════════════════════════════════ */}
      <DetailSection title="Subscription History">
        {historyError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            Failed to load subscription history.
          </div>
        )}

        {historyLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !history || history.length === 0 ? (
          <EmptyState
            icon={<Clock size={40} weight="thin" />}
            title="No history events"
            description="State changes for this subscription will appear here."
          />
        ) : (
          <ol className="relative space-y-6 border-l border-gray-200 pl-6 dark:border-gray-700">
            {history.map((item: SubscriptionHistoryItem) => {
              const isConversion =
                item.metadata != null &&
                (item.metadata as Record<string, unknown>).reason === 'full_course_conversion';

              return (
                <li key={item.historyId} className="relative">
                  <span
                    className={`absolute -left-[29px] top-1 h-3 w-3 rounded-full border-2 border-white ${
                      isConversion ? 'bg-indigo-500' : 'bg-amber-500'
                    } dark:border-gray-900`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={getChangeReasonLabel(item.changeReason)} showDot={false} />
                    {item.statusBefore && item.statusAfter && (
                      <span className="text-xs text-gray-500">
                        {item.statusBefore} → {item.statusAfter}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{formatDateTime(item.occurredAt)}</span>
                  </div>
                  {isConversion && (
                    <p className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                      Full Course Conversion — the student permanently owns this course.
                    </p>
                  )}
                  {item.paymentReference && (
                    <p className="mt-1 font-mono text-[11px] text-gray-400">
                      Ref: {item.paymentReference}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </DetailSection>
    </div>
  );
}
