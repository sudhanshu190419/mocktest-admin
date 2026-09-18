'use client';

import React from 'react';
import {
  ChatCircleDots,
  Clock,
  CheckCircle,
} from '@phosphor-icons/react';
import type { DoubtStatus } from '@/types/doubt';

interface StudentDoubtStatsProps {
  totalCount: number;
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
  isLoading?: boolean;
  activeStatus?: DoubtStatus | 'all';
  onStatusSelect?: (status: DoubtStatus | 'all') => void;
}

export const StudentDoubtStats: React.FC<StudentDoubtStatsProps> = ({
  totalCount,
  openCount,
  inProgressCount,
  resolvedCount,
  isLoading = false,
  activeStatus = 'all',
  onStatusSelect,
}) => {
  const pendingCount = openCount + inProgressCount;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl bg-white p-5 border border-slate-200/80 shadow-xs"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 w-24 bg-slate-100 rounded-md" />
              <div className="h-9 w-9 bg-slate-100 rounded-xl" />
            </div>
            <div className="h-8 w-16 bg-slate-100 rounded-lg mb-1" />
            <div className="h-3 w-32 bg-slate-100 rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      id: 'all' as const,
      label: 'Total Doubts',
      count: totalCount,
      subtitle: 'All submitted queries',
      icon: ChatCircleDots,
      iconColor: 'text-sky-600',
      iconBg: 'bg-sky-50 border-sky-100',
      activeRing: 'ring-2 ring-sky-500/40 border-sky-300 bg-sky-50/20',
      badgeBg: 'bg-sky-100 text-sky-800',
    },
    {
      id: 'open' as const,
      label: 'Pending Resolution',
      count: pendingCount,
      subtitle: `${openCount} open • ${inProgressCount} in review`,
      icon: Clock,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50 border-amber-100',
      activeRing: 'ring-2 ring-amber-500/40 border-amber-300 bg-amber-50/20',
      badgeBg: 'bg-amber-100 text-amber-800',
    },
    {
      id: 'resolved' as const,
      label: 'Resolved Solutions',
      count: resolvedCount,
      subtitle: 'Verified faculty answers',
      icon: CheckCircle,
      iconColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50 border-emerald-100',
      activeRing: 'ring-2 ring-emerald-500/40 border-emerald-300 bg-emerald-50/20',
      badgeBg: 'bg-emerald-100 text-emerald-800',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {statCards.map((card) => {
        const Icon = card.icon;
        const isSelected =
          card.id === 'open'
            ? activeStatus === 'open' || activeStatus === 'in_progress'
            : activeStatus === card.id;

        return (
          <div
            key={card.id}
            onClick={() => onStatusSelect && onStatusSelect(card.id)}
            role={onStatusSelect ? 'button' : undefined}
            tabIndex={onStatusSelect ? 0 : undefined}
            onKeyDown={(e) => {
              if (onStatusSelect && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onStatusSelect(card.id);
              }
            }}
            className={`group relative flex flex-col justify-between rounded-2xl border bg-white p-5 shadow-xs transition-all duration-200 ${
              isSelected
                ? card.activeRing
                : 'border-slate-200/80 hover:border-slate-300 hover:shadow-sm'
            } ${onStatusSelect ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 tracking-wide uppercase">
                {card.label}
              </span>
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl border ${card.iconBg} ${card.iconColor} transition-transform group-hover:scale-105`}
              >
                <Icon size={22} weight="duotone" />
              </div>
            </div>

            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight font-sans">
                  {card.count}
                </span>
                {totalCount > 0 && card.id !== 'all' && (
                  <span className="text-[11px] font-semibold text-slate-400">
                    ({Math.round((card.count / totalCount) * 100)}%)
                  </span>
                )}
              </div>
              <p className="text-xs font-medium text-slate-500 leading-snug">
                {card.subtitle}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
