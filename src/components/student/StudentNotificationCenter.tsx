'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  CheckCircle,
  X,
  Check,
  Exam,
  VideoCamera,
  BookOpen,
  Receipt,
  GraduationCap,
  Sparkle,
  Info,
  Clock,
  ArrowRight,
  WarningCircle,
  CircleNotch
} from '@phosphor-icons/react';
import {
  fetchStudentNotifications,
  markStudentNotificationAsRead,
  markAllStudentNotificationsAsRead,
  type StudentNotificationItem,
  type StudentNotificationType,
} from '@/services/student/studentNotificationWebService';

interface StudentNotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  unreadCount: number;
  onUnreadCountChange: (count: number) => void;
}

type FilterTab = 'all' | 'unread' | 'mock-test' | 'live-class' | 'doubt';

export const StudentNotificationCenter: React.FC<StudentNotificationCenterProps> = ({
  isOpen,
  onClose,
  unreadCount,
  onUnreadCountChange,
}) => {
  const router = useRouter();
  const popoverRef = useRef<HTMLDivElement>(null);

  const [notifications, setNotifications] = useState<StudentNotificationItem[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // ── Load Notifications ──────────────────────────────────────────────────
  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchStudentNotifications({
        pageSize: 30,
        type: activeTab === 'all' ? 'all' : activeTab === 'unread' ? 'unread' : activeTab,
      });
      setNotifications(res.data);
      onUnreadCountChange(res.unreadCount);
    } catch (err: any) {
      setError(err?.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [activeTab, onUnreadCountChange]);

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen, loadNotifications]);

  // ── Keyboard (Escape) & Click Outside Listeners ──────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // ── Mark Single As Read & Navigate ──────────────────────────────────────
  const handleNotificationClick = async (n: StudentNotificationItem) => {
    if (!n.isRead) {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item))
      );
      onUnreadCountChange(Math.max(0, unreadCount - 1));
      markStudentNotificationAsRead(n.notificationId || n.id).catch(() => {});
    }

    onClose();

    if (n.href) {
      router.push(n.href);
    }
  };

  // ── Mark All As Read ────────────────────────────────────────────────────
  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    try {
      setMarkingAll(true);
      // Optimistic update
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      onUnreadCountChange(0);
      await markAllStudentNotificationsAsRead();
    } catch (err) {
      console.warn('Failed to mark all as read:', err);
    } finally {
      setMarkingAll(false);
    }
  };

  if (!isOpen) return null;

  // ── Icon & Color Resolver ───────────────────────────────────────────────
  const getCategoryConfig = (type: StudentNotificationType) => {
    switch (type) {
      case 'mock-test':
        return {
          icon: <Exam size={16} weight="duotone" className="text-purple-600" />,
          bg: 'bg-purple-50 border-purple-100',
          label: 'Mock Test',
        };
      case 'result':
        return {
          icon: <CheckCircle size={16} weight="duotone" className="text-emerald-600" />,
          bg: 'bg-emerald-50 border-emerald-100',
          label: 'Result',
        };
      case 'live-class':
        return {
          icon: <VideoCamera size={16} weight="duotone" className="text-rose-600" />,
          bg: 'bg-rose-50 border-rose-100',
          label: 'Live Class',
        };
      case 'course':
        return {
          icon: <BookOpen size={16} weight="duotone" className="text-brand" />,
          bg: 'bg-sky-tint border-line',
          label: 'Course',
        };
      case 'doubt':
        return {
          icon: <GraduationCap size={16} weight="duotone" className="text-brand" />,
          bg: 'bg-sky-tint border-line',
          label: 'Doubt',
        };
      case 'payment':
        return {
          icon: <Receipt size={16} weight="duotone" className="text-amber-600" />,
          bg: 'bg-amber-50 border-amber-100',
          label: 'Payment',
        };
      case 'announcement':
        return {
          icon: <Sparkle size={16} weight="duotone" className="text-violet-600" />,
          bg: 'bg-violet-50 border-violet-100',
          label: 'Announcement',
        };
      case 'system':
      default:
        return {
          icon: <Info size={16} weight="duotone" className="text-ink-secondary" />,
          bg: 'bg-paper border-line',
          label: 'System',
        };
    }
  };

  // ── Timestamp Formatter ─────────────────────────────────────────────────
  const formatTimestamp = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return 'Recent';
    }
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Student Notification Center"
      aria-modal="true"
      className="fixed inset-x-3 top-18 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 z-50 w-auto sm:w-[420px] rounded-3xl bg-white border border-line/90 shadow-2xl shadow-card overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[600px] animate-fadeIn"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-paper/70">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-extrabold text-ink tracking-tight">Notifications</h3>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-caption font-black tracking-wide">
              {unreadCount} new
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={markingAll}
              className="text-caption font-bold text-brand hover:text-brand-hover hover:underline flex items-center gap-1 disabled:opacity-50"
            >
              {markingAll ? (
                <CircleNotch size={12} className="animate-spin" />
              ) : (
                <Check size={12} weight="bold" />
              )}
              <span>Mark all read</span>
            </button>
          )}

          <button
            onClick={onClose}
            aria-label="Close notification center"
            className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-sky-tint/60 transition-colors"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      </div>

      {/* ── Filter Chips ─────────────────────────────────────────────────── */}
      <div className="px-4 py-2 border-b border-line flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-white">
        {[
          { id: 'all', label: 'All' },
          { id: 'unread', label: `Unread (${unreadCount})` },
          { id: 'mock-test', label: 'Tests' },
          { id: 'live-class', label: 'Live' },
          { id: 'doubt', label: 'Doubts' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as FilterTab)}
            className={`px-3 py-1 rounded-xl text-caption font-bold whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-brand text-white shadow-xs'
                : 'bg-paper/70 text-ink-secondary hover:bg-paper hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Content Body ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto divide-y divide-line">
        {loading ? (
          /* Loading Skeletons */
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-3 rounded-2xl bg-paper animate-pulse flex gap-3">
                <div className="h-9 w-9 rounded-xl bg-sky-tint shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 bg-sky-tint rounded" />
                  <div className="h-2.5 w-full bg-paper rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          /* Error State */
          <div className="p-8 text-center space-y-3">
            <WarningCircle size={32} weight="duotone" className="text-red-500 mx-auto" />
            <p className="text-xs font-bold text-ink">Failed to load notifications</p>
            <p className="text-caption text-ink-secondary max-w-xs mx-auto">{error}</p>
            <button
              onClick={loadNotifications}
              className="px-3.5 py-1.5 rounded-xl bg-brand text-white font-bold text-xs hover:bg-brand-hover transition-colors shadow-xs"
            >
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          /* Empty State */
          <div className="p-10 text-center space-y-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 mx-auto shadow-xs">
              <CheckCircle size={24} weight="duotone" />
            </div>
            <h4 className="text-xs font-extrabold text-ink">{"You're all caught up."}</h4>
            <p className="text-caption text-ink-secondary max-w-xs mx-auto leading-relaxed">
              {activeTab === 'unread'
                ? 'No unread notifications at this time.'
                : 'Academic updates, mock test releases, and faculty replies will appear here.'}
            </p>
          </div>
        ) : (
          /* Notification List Items */
          notifications.map((n) => {
            const config = getCategoryConfig(n.type);
            return (
              <button
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`w-full p-4 text-left transition-colors flex items-start gap-3.5 hover:bg-paper/80 ${
                  !n.isRead ? 'bg-sky-tint/35 font-medium' : 'bg-white'
                }`}
              >
                {/* Category Icon */}
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-2xl shrink-0 border ${config.bg} shadow-xs`}
                >
                  {config.icon}
                </div>

                {/* Text Content */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-caption font-bold text-ink-muted uppercase tracking-wider">
                      {config.label}
                    </span>
                    <span className="text-caption font-semibold text-ink-muted shrink-0">
                      {formatTimestamp(n.createdAt)}
                    </span>
                  </div>

                  <h4
                    className={`text-xs leading-snug truncate ${
                      !n.isRead ? 'font-black text-ink' : 'font-semibold text-ink'
                    }`}
                  >
                    {n.title}
                  </h4>

                  {n.description && (
                    <p className="text-caption text-ink-secondary line-clamp-2 leading-relaxed">
                      {n.description}
                    </p>
                  )}
                </div>

                {/* Unread Indicator Dot / Arrow */}
                <div className="shrink-0 flex items-center self-center pl-1">
                  {!n.isRead ? (
                    <span className="h-2 w-2 rounded-full bg-brand ring-4 ring-line" />
                  ) : (
                    <ArrowRight size={13} className="text-ink-muted" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="p-3 bg-paper border-t border-line text-center">
        <span className="text-caption font-semibold text-ink-muted">
          Notifications are automatically archived after 30 days.
        </span>
      </div>
    </div>
  );
};
