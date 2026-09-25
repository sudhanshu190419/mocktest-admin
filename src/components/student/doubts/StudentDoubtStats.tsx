'use client';

import React from 'react';
import {
  IconDoubt,
  IconClock,
  IconCheckCircle,
  IconHourglass,
} from '@/components/icons/student-icons';
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
            className="animate-pulse rounded-card bg-surface p-5 border border-line shadow-card space-y-3"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 w-24 bg-paper rounded-md" />
              <div className="h-9 w-9 bg-paper rounded-field" />
            </div>
            <div className="h-8 w-16 bg-paper rounded-lg mb-1" />
            <div className="h-3 w-32 bg-paper rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  // PRD §7.2: Status vocabulary + "—" when empty
  const statCards = [
    {
      id: 'all' as const,
      label: 'All Doubts',
      count: totalCount,
      displayCount: totalCount > 0 ? totalCount : '—',
      subtitle: totalCount > 0 ? 'All submitted questions' : 'No doubts submitted yet',
      icon: IconDoubt,
      iconColor: 'text-brand',
      iconBg: 'bg-sky-tint border-line',
      activeRing: 'ring-2 ring-brand border-brand bg-sky-tint/30',
      badgeBg: 'bg-sky-tint text-brand-hover',
    },
    {
      id: 'open' as const,
      label: 'Waiting on Faculty',
      count: pendingCount,
      displayCount: pendingCount > 0 ? pendingCount : '—',
      subtitle: pendingCount > 0 ? `${openCount} open · ${inProgressCount} faculty is on it` : 'Zero pending replies',
      icon: IconHourglass,
      iconColor: 'text-sand-ink',
      iconBg: 'bg-sand border-amber-200',
      activeRing: 'ring-2 ring-amber-500 border-amber-400 bg-sand/30',
      badgeBg: 'bg-sand text-sand-ink',
    },
    {
      id: 'resolved' as const,
      label: 'Resolved Doubts',
      count: resolvedCount,
      displayCount: resolvedCount > 0 ? resolvedCount : '—',
      subtitle: resolvedCount > 0 ? 'Verified faculty solutions' : 'No resolved doubts yet',
      icon: IconCheckCircle,
      iconColor: 'text-mint-ink',
      iconBg: 'bg-mint-tint border-emerald-200',
      activeRing: 'ring-2 ring-emerald-500 border-emerald-400 bg-mint-tint/30',
      badgeBg: 'bg-mint-tint text-mint-ink',
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
            className={`group relative flex min-h-[110px] flex-col justify-between rounded-card border bg-surface p-5 sm:p-6 shadow-card transition-all duration-200 ${
              isSelected
                ? card.activeRing
                : 'border-line hover:border-line hover:shadow-card-hover'
            } ${onStatusSelect ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption font-bold text-ink-secondary tracking-wide uppercase">
                {card.label}
              </span>
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-field border ${card.iconBg} ${card.iconColor} transition-transform group-hover:scale-105`}
              >
                <Icon size={22} />
              </div>
            </div>

            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl sm:text-display font-black text-ink tracking-tight tabular-nums">
                  {card.displayCount}
                </span>
                {totalCount > 0 && card.id !== 'all' && card.count > 0 && (
                  <span className="text-caption font-semibold text-ink-secondary">
                    ({Math.round((card.count / totalCount) * 100)}%)
                  </span>
                )}
              </div>
              <p className="text-caption font-medium text-ink-secondary leading-snug">
                {card.subtitle}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
