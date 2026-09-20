'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bell } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { StudentNotificationCenter } from '@/components/student/StudentNotificationCenter';
import { fetchStudentNotifications } from '@/services/student/studentNotificationWebService';

/**
 * PRD §10.5 — notification bell for the shell header.
 * Unread dot from a cheap 1-item fetch (60s cache); the panel itself
 * (StudentNotificationCenter) loads the full list on open.
 */
export function StudentBellButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [localUnread, setLocalUnread] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery<{ unreadCount: number }>({
    queryKey: ['student-notification-unread'],
    queryFn: async () => {
      const res = await fetchStudentNotifications({ pageSize: 1 });
      return { unreadCount: res.unreadCount ?? 0 };
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const unreadCount = localUnread ?? data?.unreadCount ?? 0;

  // Close on outside click / Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className="store-bell-btn"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <Bell size={18} weight={unreadCount > 0 ? 'fill' : 'regular'} />
        {unreadCount > 0 && (
          <span className="store-bell-dot" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <StudentNotificationCenter
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        unreadCount={unreadCount}
        onUnreadCountChange={(count) => setLocalUnread(count)}
      />
    </div>
  );
}
