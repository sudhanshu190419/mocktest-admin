'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useCommerceMetrics } from '@/hooks/admin/useCommerce';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import {
  ShoppingCart,
  CurrencyCircleDollar,
  CheckCircle,
  Clock,
  BookOpen,
  Package,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton
// ═══════════════════════════════════════════════════════════════════════════

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <Skeleton className="mb-2 h-3 w-20" />
          <Skeleton className="mb-1 h-7 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function CommercePage() {
  const { instituteId } = useAuth();
  const { data: metrics, isLoading, isError } = useCommerceMetrics(instituteId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commerce Verification"
        description="Verify and audit the complete purchase lifecycle across all products."
      />

      {/* ════════════════════════════════════════════════════════════════════
          Error State
         ════════════════════════════════════════════════════════════════════ */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            Failed to load commerce metrics
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Metrics Cards
         ════════════════════════════════════════════════════════════════════ */}
      {isLoading ? (
        <MetricsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Total Orders"
            value={(metrics?.totalOrders ?? 0).toLocaleString()}
            icon={<ShoppingCart size={20} weight="duotone" />}
            color="blue"
          />
          <MetricCard
            label="Total Revenue"
            value={`₹${(metrics?.totalRevenue ?? 0).toLocaleString()}`}
            icon={<CurrencyCircleDollar size={20} weight="duotone" />}
            color="emerald"
          />
          <MetricCard
            label="Captured Payments"
            value={(metrics?.capturedPayments ?? 0).toLocaleString()}
            icon={<CheckCircle size={20} weight="duotone" />}
            color="indigo"
          />
          <MetricCard
            label="Pending Payments"
            value={(metrics?.pendingPayments ?? 0).toLocaleString()}
            icon={<Clock size={20} weight="duotone" />}
            color="amber"
          />
          <MetricCard
            label="Course Enrollments"
            value={(metrics?.courseEnrollments ?? 0).toLocaleString()}
            icon={<BookOpen size={20} weight="duotone" />}
            color="purple"
          />
          <MetricCard
            label="PYQ Purchases"
            value={(metrics?.pyqPurchases ?? 0).toLocaleString()}
            icon={<Package size={20} weight="duotone" />}
            color="cyan"
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Navigation Quick Links
         ════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/commerce/orders"
          className="group rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
            <ShoppingCart size={24} weight="duotone" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Orders</h3>
          <p className="mt-1 text-xs text-gray-500">
            View and filter all orders. Track status, amounts, and confirmations.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 group-hover:gap-1.5 transition-all">
            View Orders →
          </span>
        </Link>

        <Link
          href="/admin/commerce/payments"
          className="group rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-emerald-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
            <CurrencyCircleDollar size={24} weight="duotone" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Payments</h3>
          <p className="mt-1 text-xs text-gray-500">
            Monitor payment attempts, failures, and refunds.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 group-hover:gap-1.5 transition-all">
            View Payments →
          </span>
        </Link>

        <Link
          href="/admin/commerce/courses"
          className="group rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-purple-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
            <BookOpen size={24} weight="duotone" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Course Purchases</h3>
          <p className="mt-1 text-xs text-gray-500">
            Verify course enrollments and student access.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-purple-600 group-hover:gap-1.5 transition-all">
            View Course Purchases →
          </span>
        </Link>

        <Link
          href="/admin/commerce/pyq"
          className="group rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-cyan-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-400">
            <Package size={24} weight="duotone" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">PYQ Purchases</h3>
          <p className="mt-1 text-xs text-gray-500">
            Verify PYQ package purchases and student access.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cyan-600 group-hover:gap-1.5 transition-all">
            View PYQ Purchases →
          </span>
        </Link>
      </div>
    </div>
  );
}
