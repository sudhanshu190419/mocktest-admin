'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  VideoCamera,
  CalendarBlank,
  ChartLineUp,
  XCircle,
  PlusCircle,
  CircleNotch,
  PlayCircle,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { teacherLiveClassService, type LiveClassListItem } from '@/services/teacherLiveClassService';
import { ClassCard, type ClassAction } from '@/components/scheduling/ClassCard';
import { ScheduleClassDialog } from '@/components/scheduling/ScheduleClassDialog';
import { EditScheduledClassDialog } from '@/components/scheduling/EditScheduledClassDialog';
import { LiveStudioView } from '@/components/live-studio/LiveStudioView';

// ─── Tab type ──────────────────────────────────────────────────────────────

type TabId = 'upcoming' | 'live' | 'completed' | 'cancelled';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'upcoming', label: 'Upcoming', icon: CalendarBlank },
  { id: 'live', label: 'Live Now', icon: PlayCircle },
  { id: 'completed', label: 'Completed', icon: ChartLineUp },
  { id: 'cancelled', label: 'Cancelled', icon: XCircle },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function ScheduledClassesView({ onLaunchLive }: { onLaunchLive?: () => void }) {
  const { teacherProfile } = useAuth();
  const teacherId = teacherProfile?.id ?? '';

  const [activeTab, setActiveTab] = useState<TabId>('upcoming');
  const [classes, setClasses] = useState<LiveClassListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [editClassId, setEditClassId] = useState<string | null>(null);
  const [cancelClassId, setCancelClassId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // LiveStudio — tracks which scheduled class is being launched (or null for Instant Go Live)
  const [launchingClassId, setLaunchingClassId] = useState<string | null>(null);

  // ── Unified fetch ─────────────────────────────────────────────────────

  const fetchClasses = useCallback(async () => {
    if (!teacherId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [scheduledRes, liveItems, completedRes] = await Promise.all([
        teacherLiveClassService.getTeacherScheduledClasses(teacherId),
        teacherLiveClassService.getTeacherLiveClasses(teacherId),
        teacherLiveClassService.getTeacherCompletedClasses(teacherId),
      ]);

      // TeacherClassListResponse has { classes: LiveClassListItem[] }
      // getTeacherLiveClasses() returns LiveClassListItem[] directly
      const all = [
        ...scheduledRes.classes,
        ...liveItems,
        ...completedRes.classes,
      ];

      // Deduplicate by classId
      const seen = new Set<string>();
      const unique: LiveClassListItem[] = [];
      for (const item of all) {
        if (!seen.has(item.classId)) {
          seen.add(item.classId);
          unique.push(item);
        }
      }

      setClasses(unique);
    } catch (err: any) {
      setError(err?.message || 'Failed to load classes.');
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  // ── Filter by active tab ──────────────────────────────────────────────

  const filteredClasses = classes.filter((c) => {
    if (activeTab === 'upcoming') return c.status === 'scheduled';
    if (activeTab === 'live') return c.status === 'live';
    if (activeTab === 'completed') return c.status === 'completed';
    if (activeTab === 'cancelled') return c.status === 'cancelled';
    return true;
  });

  // Sort upcoming by date ASC, completed/cancelled by date DESC
  const sortedClasses = [...filteredClasses].sort((a, b) => {
    if (activeTab === 'upcoming' || activeTab === 'live') {
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    }
    return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
  });

  // ── Actions ───────────────────────────────────────────────────────────

  function handleAction(action: ClassAction) {
    switch (action.type) {
      case 'start':
        // Set the launching classId — LiveStudioView will pick it up
        setLaunchingClassId(action.classId);
        break;
      case 'edit':
        setEditClassId(action.classId);
        break;
      case 'cancel':
        setCancelClassId(action.classId);
        break;
      case 'view':
        // Future: navigate to detail page
        break;
    }
  }

  async function confirmCancel() {
    if (!cancelClassId || !teacherId) return;
    setCancelling(true);
    try {
      await teacherLiveClassService.cancelScheduledClass(cancelClassId, teacherId);
      setCancelClassId(null);
      await fetchClasses();
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel class.');
    } finally {
      setCancelling(false);
    }
  }

  // ── Tab counts ────────────────────────────────────────────────────────

  const counts = {
    upcoming: classes.filter((c) => c.status === 'scheduled').length,
    live: classes.filter((c) => c.status === 'live').length,
    completed: classes.filter((c) => c.status === 'completed').length,
    cancelled: classes.filter((c) => c.status === 'cancelled').length,
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">Live Classes</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage your scheduled, live, and past classes
          </p>
        </div>
        <button
          onClick={() => setShowScheduleDialog(true)}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700"
        >
          <PlusCircle size={18} weight="fill" />
          Schedule Class
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-2xl bg-gray-100 p-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const count = counts[tab.id];
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
              <span>{tab.label}</span>
              {count > 0 && (
                <span
                  className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    tab.id === 'live'
                      ? 'bg-green-100 text-green-700'
                      : tab.id === 'upcoming'
                      ? 'bg-blue-100 text-blue-700'
                      : tab.id === 'cancelled'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <CircleNotch size={36} className="animate-spin text-blue-600" />
            <p className="text-sm text-gray-500 font-medium">Loading your classes...</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <XCircle size={32} className="mx-auto text-red-400 mb-2" />
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button
              onClick={fetchClasses}
              className="mt-3 rounded-xl bg-red-100 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-200 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : sortedClasses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
              {activeTab === 'live' ? (
                <VideoCamera size={32} className="text-gray-300" />
              ) : activeTab === 'upcoming' ? (
                <CalendarBlank size={32} className="text-gray-300" />
              ) : activeTab === 'completed' ? (
                <ChartLineUp size={32} className="text-gray-300" />
              ) : (
                <XCircle size={32} className="text-gray-300" />
              )}
            </div>
            <h4 className="text-base font-bold text-gray-700 mb-1">
              {activeTab === 'upcoming'
                ? 'No upcoming classes'
                : activeTab === 'live'
                ? 'No live classes right now'
                : activeTab === 'completed'
                ? 'No completed classes'
                : 'No cancelled classes'}
            </h4>
            <p className="text-sm text-gray-400 max-w-sm">
              {activeTab === 'upcoming'
                ? 'Schedule your first class to get started.'
                : activeTab === 'live'
                ? 'Start a scheduled class when you\'re ready to go live.'
                : 'Classes will appear here once they\'re completed or cancelled.'}
            </p>
            {activeTab === 'upcoming' && (
              <button
                onClick={() => setShowScheduleDialog(true)}
                className="mt-4 flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                <PlusCircle size={18} weight="fill" />
                Schedule Your First Class
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedClasses.map((item) => (
              <ClassCard key={item.classId} item={item} onAction={handleAction} />
            ))}
          </div>
        )}
      </div>

      {/* Schedule Dialog */}
      <ScheduleClassDialog
        isOpen={showScheduleDialog}
        onClose={() => setShowScheduleDialog(false)}
        teacherId={teacherId}
        onScheduled={fetchClasses}
      />

      {/* Edit Dialog */}
      {editClassId && (
        <EditScheduledClassDialog
          isOpen={!!editClassId}
          onClose={() => setEditClassId(null)}
          teacherId={teacherId}
          classId={editClassId}
          onUpdated={fetchClasses}
        />
      )}

      {/* LiveStudioView — launched from a scheduled class card */}
      <LiveStudioView
        isOpen={!!launchingClassId}
        onClose={() => {
          setLaunchingClassId(null);
          fetchClasses();
        }}
        scheduledClassId={launchingClassId ?? undefined}
        onLiveClassStarted={fetchClasses}
      />

      {/* Cancel Confirmation Modal */}
      {cancelClassId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mx-auto">
              <XCircle size={24} className="text-red-500" />
            </div>
            <h3 className="text-center text-lg font-bold text-gray-900 mb-1">Cancel Class?</h3>
            <p className="text-center text-sm text-gray-500 mb-6">
              This action cannot be undone. Students will be notified if the class is cancelled.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelClassId(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Keep Class
              </button>
              <button
                onClick={confirmCancel}
                disabled={cancelling}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cancelling ? (
                  <>
                    <CircleNotch size={16} className="animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Yes, Cancel'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
