'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/config/supabase';
import { useNotificationPermissions, AUDIENCE_LABELS } from '@/hooks/notification/useNotificationPermissions';
import { useSendAudienceNotification } from '@/hooks/notification/useSendNotification';
import { PageHeader } from '@/components/ui/PageHeader';
import { priorityLabel, priorityColor } from '@/utils/notification';
import type { NotificationPriority, NotificationAudienceType } from '@/types/notification';

const PRIORITIES: { value: NotificationPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400' },
  { value: 'high', label: 'High', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400' },
  { value: 'critical', label: 'Critical', color: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400' },
];

export default function AdminCreateNotificationPage() {
  const router = useRouter();
  const { user, instituteId, teacherProfile } = useAuth();
  const role = (teacherProfile?.role as 'admin' | 'teacher') ?? 'admin';
  const { allowedAudiences, canSendPush } = useNotificationPermissions(role);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<NotificationPriority>('normal');
  const [audienceType, setAudienceType] = useState<NotificationAudienceType>('students');
  const [selectedBatch, setSelectedBatch] = useState('');
  const [sendPush, setSendPush] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const sendNotif = useSendAudienceNotification();

  // Fetch batches for batch audience
  const { data: batches } = useQuery({
    queryKey: ['admin', 'batches', instituteId],
    queryFn: async () => {
      const { data } = await supabase
        .from('batches')
        .select('batch_id, batch_name')
        .eq('institute_id', instituteId)
        .order('batch_name');
      return data ?? [];
    },
    enabled: !!instituteId && audienceType === 'batch',
  });

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Title is required';
    if (title.trim().length < 3) errs.title = 'Title must be at least 3 characters';
    if (!message.trim()) errs.message = 'Message is required';
    if (message.trim().length < 10) errs.message = 'Message must be at least 10 characters';
    if (audienceType === 'batch' && !selectedBatch) errs.batch = 'Please select a batch';
    if (scheduleMode === 'scheduled' && !scheduledDate) errs.scheduledDate = 'Date is required for scheduled notifications';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [title, message, audienceType, selectedBatch, scheduleMode, scheduledDate]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    if (!instituteId) {
      setErrors({ instituteId: 'Institute not found. Cannot create notification.' });
      return;
    }

    const payload = {
      instituteId,
      title: title.trim(),
      body: message.trim(),
      eventType: 'announcement',
      priority,
      channel: 'in_app' as const,
      triggeredBy: user?.id ?? null,
      referenceType: null,
      referenceId: null,
      audience: {
        type: audienceType,
        batchId: audienceType === 'batch' ? selectedBatch : undefined,
      },
      sendPush: sendPush && canSendPush,
    };

    try {
      await sendNotif.mutateAsync({
        input: payload,
        userRole: role,
        teacherId: role === 'teacher' ? user?.id : undefined,
      });
      router.push('/admin/notifications');
    } catch (err) {
      setErrors({ submit: (err as Error)?.message ?? 'Failed to create notification' });
    }
  }, [validate, instituteId, title, message, priority, audienceType, selectedBatch, sendPush, canSendPush, scheduleMode, sendNotif, router, user, role]);

  const isPending = sendNotif.isPending;

  return (
    <div>
      <PageHeader
        title="Create Notification"
        description="Send a notification or announcement to your audience"
        breadcrumbs={[
          { label: 'Notifications', href: '/admin/notifications' },
          { label: 'Create' },
        ]}
      />

      <div className="mx-auto max-w-3xl space-y-6">
        {/* Title & Message */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Content</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Holiday Notice, Test Schedule Change"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Message <span className="text-red-500">*</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="Write your notification message here..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              {errors.message && <p className="mt-1 text-xs text-red-500">{errors.message}</p>}
              <p className="mt-1 text-xs text-gray-400">{message.length} characters</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Priority */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Priority</h3>
            <div className="space-y-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                    priority === p.value
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                      : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                  }`}
                >
                  <div className={`h-3 w-3 rounded-full ${p.value === 'critical' ? 'bg-red-500' : p.value === 'high' ? 'bg-amber-500' : p.value === 'normal' ? 'bg-blue-500' : 'bg-gray-400'}`} />
                  <span className="font-medium text-gray-700 dark:text-gray-300">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Target Audience */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Target Audience</h3>
            <div className="space-y-2">
              {allowedAudiences.map((type) => {
                const info = AUDIENCE_LABELS[type];
                const isComingSoon = type === 'specific_students' || type === 'specific_teachers';
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => !isComingSoon && setAudienceType(type)}
                    disabled={isComingSoon}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                      audienceType === type
                        ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                    } ${isComingSoon ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className={`h-3 w-3 rounded-full ${audienceType === type ? 'bg-blue-500' : 'bg-gray-400'}`} />
                    <div className="text-left">
                      <p className="font-medium text-gray-700 dark:text-gray-300">
                        {info.icon} {info.label}
                        {isComingSoon && <span className="ml-1.5 text-[9px] text-amber-500">(coming soon)</span>}
                      </p>
                      <p className="text-[10px] text-gray-400">{info.description}</p>
                    </div>
                  </button>
                );
              })}
              {audienceType === 'batch' && batches && (
                <select
                  value={selectedBatch}
                  onChange={(e) => setSelectedBatch(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="">Select a batch...</option>
                  {batches.map((b: { batch_id: string; batch_name: string }) => (
                    <option key={b.batch_id} value={b.batch_id}>{b.batch_name}</option>
                  ))}
                </select>
              )}
              {errors.batch && <p className="mt-1 text-xs text-red-500">{errors.batch}</p>}
            </div>
          </div>
        </div>

        {/* Push Notification Toggle */}
        {canSendPush && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Delivery</h3>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sendPush}
                onChange={(e) => setSendPush(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Also send as Push Notification (FCM)</p>
                <p className="text-xs text-gray-400">Recipients will receive a push notification on their mobile devices</p>
              </div>
            </label>
          </div>
        )}

        {/* Schedule */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Schedule</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setScheduleMode('immediate')}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs transition-colors ${
                  scheduleMode === 'immediate'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-400'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
                }`}
              >
                <span>📨</span>
                <span className="font-medium">Send Immediately</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('scheduled')}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs transition-colors ${
                  scheduleMode === 'scheduled'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-400'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
                }`}
              >
                <span>⏰</span>
                <span className="font-medium">Schedule for Later</span>
              </button>
            </div>
            {scheduleMode === 'scheduled' && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  {errors.scheduledDate && <p className="mt-1 text-xs text-red-500">{errors.scheduledDate}</p>}
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Time</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Preview</h3>
          <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/30">
            <span className="text-xl">📢</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title || 'Notification Title'}</p>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityColor(priority)}`}>
                  {priorityLabel(priority)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{message || 'Your notification message will appear here...'}</p>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                <span>📢 Announcement</span>
                <span>·</span>
                <span>{AUDIENCE_LABELS[audienceType]?.label ?? 'Selected audience'}</span>
                {sendPush && <><span>·</span><span>📱 Push</span></>}
                <span>·</span>
                <span>{scheduleMode === 'immediate' ? 'Send immediately' : `Scheduled for ${scheduledDate || '...'}`}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {errors.submit}
          </div>
        )}
        {errors.instituteId && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {errors.instituteId}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push('/admin/notifications')}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Sending...' : scheduleMode === 'immediate' ? 'Send Now' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
