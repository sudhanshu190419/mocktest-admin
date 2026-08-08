'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSubscriptionCourses } from '@/hooks/admin/useSubscriptionAdmin';
import {
  useCreateSubscriptionPlan,
  useUpdateSubscriptionPlan,
} from '@/hooks/admin/useSubscriptionPlanAdmin';
import {
  BILLING_CYCLE_DURATION_DAYS,
  PLAN_BILLING_CYCLE_OPTIONS,
  getBillingCycleLabel,
  type PlanBillingCycle,
  type SubscriptionPlanListItem,
} from '@/services/admin/subscriptionPlanAdminService';
import { cn } from '@/lib/utils';
import { CircleNotch, X } from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface FormState {
  courseId: string;
  name: string;
  description: string;
  billingCycle: string;
  price: string;
  durationDays: string;
  trialDays: string;
  maxStudents: string;
  isFeatured: boolean;
  isActive: boolean;
}

interface FormErrors {
  courseId?: string;
  name?: string;
  billingCycle?: string;
  price?: string;
  durationDays?: string;
  trialDays?: string;
  maxStudents?: string;
  submit?: string;
}

interface SubscriptionPlanFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** The plan being edited (null for create). */
  plan?: SubscriptionPlanListItem | null;
  onClose: () => void;
  onSuccess?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY_STATE: FormState = {
  courseId: '',
  name: '',
  description: '',
  billingCycle: 'monthly',
  price: '',
  durationDays: '30',
  trialDays: '0',
  maxStudents: '',
  isFeatured: false,
  isActive: true,
};

function stateFromPlan(plan: SubscriptionPlanListItem): FormState {
  return {
    courseId: plan.courseId ?? '',
    name: plan.name,
    description: plan.description ?? '',
    billingCycle: plan.billingCycle ?? 'monthly',
    price: String(plan.price),
    durationDays: String(plan.durationDays),
    trialDays: String(plan.trialDays),
    maxStudents: plan.maxStudents != null ? String(plan.maxStudents) : '',
    isFeatured: plan.isFeatured,
    isActive: plan.isActive,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function SubscriptionPlanFormModal({
  open,
  mode,
  plan,
  onClose,
  onSuccess,
}: SubscriptionPlanFormModalProps) {
  const { user, instituteId } = useAuth();
  const { data: courses } = useSubscriptionCourses(instituteId);

  // The parent remounts this modal (via a changing `key`) every time it is
  // opened, so the initial state below is always fresh — no effect needed.
  const [form, setForm] = useState<FormState>(() =>
    plan && mode === 'edit' ? stateFromPlan(plan) : EMPTY_STATE,
  );
  const [errors, setErrors] = useState<FormErrors>({});

  // Legacy cycles (e.g. lifetime/custom from before course-scoping) are not
  // offered for new plans, but must render correctly when editing an old row.
  const legacyCycle = PLAN_BILLING_CYCLE_OPTIONS.some((o) => o.value === form.billingCycle)
    ? null
    : form.billingCycle;

  const createMutation = useCreateSubscriptionPlan();
  const updateMutation = useUpdateSubscriptionPlan();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  const handleCycleChange = (cycle: string) => {
    setField('billingCycle', cycle);
    // Auto-fill the duration from the cycle, but keep it editable afterwards.
    if (cycle in BILLING_CYCLE_DURATION_DAYS) {
      setField('durationDays', String(BILLING_CYCLE_DURATION_DAYS[cycle as PlanBillingCycle]));
    }
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!form.courseId) next.courseId = 'Select a course.';
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    if (!form.billingCycle) next.billingCycle = 'Select a billing cycle.';
    const price = Number(form.price);
    if (!form.price || Number.isNaN(price) || price <= 0) {
      next.price = 'Enter a price greater than 0.';
    }
    const duration = Number(form.durationDays);
    if (!form.durationDays || Number.isNaN(duration) || duration <= 0) {
      next.durationDays = 'Duration must be greater than 0 days.';
    }
    const trial = Number(form.trialDays);
    if (Number.isNaN(trial) || trial < 0) {
      next.trialDays = 'Trial days cannot be negative.';
    }
    if (form.maxStudents !== '') {
      const max = Number(form.maxStudents);
      if (Number.isNaN(max) || max < 0) {
        next.maxStudents = 'Capacity cannot be negative.';
      }
    }
    return next;
  };

  const handleSubmit = async () => {
    const validation = validate();
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    const actorId = user?.id ?? '';
    if (!actorId) {
      setErrors({ submit: 'Your admin identity could not be resolved. Please sign in again.' });
      return;
    }

    const common = {
      courseId: form.courseId,
      name: form.name,
      description: form.description || null,
      billingCycle: form.billingCycle as PlanBillingCycle,
      price: Number(form.price),
      durationDays: Number(form.durationDays),
      trialDays: Number(form.trialDays),
      maxStudents: form.maxStudents === '' ? null : Number(form.maxStudents),
      isFeatured: form.isFeatured,
    };

    if (mode === 'create') {
      const result = await createMutation.mutateAsync({
        ...common,
        instituteId: instituteId ?? '',
        isActive: form.isActive,
        createdBy: actorId,
      });
      if (!result.success) {
        setErrors({ submit: result.error ?? 'Failed to create the plan.' });
        return;
      }
    } else if (plan) {
      const result = await updateMutation.mutateAsync({
        planId: plan.planId,
        input: { ...common, isActive: form.isActive, updatedBy: actorId },
      });
      if (!result.success) {
        setErrors({ submit: result.error ?? 'Failed to update the plan.' });
        return;
      }
    }

    onSuccess?.();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      void handleSubmit();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-form-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl animate-[fadeIn_200ms_ease-out] dark:border-gray-700 dark:bg-gray-900"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div>
            <h2 id="plan-form-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {mode === 'create' ? 'Create Subscription Plan' : `Edit Plan — ${plan?.name ?? ''}`}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              One plan per billing cycle per course. Plans belong to exactly one course.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {errors.submit && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {errors.submit}
            </div>
          )}

          {/* Course */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Course *
            </label>
            <select
              value={form.courseId}
              onChange={(e) => setField('courseId', e.target.value)}
              className={cn(
                'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-900 dark:text-gray-100',
                errors.courseId ? 'border-red-400' : 'border-gray-200 dark:border-gray-700',
              )}
            >
              <option value="">Select Course</option>
              {(courses ?? []).map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.title}
                </option>
              ))}
            </select>
            {errors.courseId && <p className="mt-1 text-[11px] text-red-600">{errors.courseId}</p>}
          </div>

          {/* Name + Billing Cycle */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Plan Name *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. NEET Crash Course Monthly"
                className={cn(
                  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-900 dark:text-gray-100',
                  errors.name ? 'border-red-400' : 'border-gray-200 dark:border-gray-700',
                )}
              />
              {errors.name && <p className="mt-1 text-[11px] text-red-600">{errors.name}</p>}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Billing Cycle *
              </label>
              <select
                value={form.billingCycle}
                onChange={(e) => handleCycleChange(e.target.value)}
                className={cn(
                  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-900 dark:text-gray-100',
                  errors.billingCycle ? 'border-red-400' : 'border-gray-200 dark:border-gray-700',
                )}
              >
                {PLAN_BILLING_CYCLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
                {legacyCycle && (
                  <option value={legacyCycle}>{getBillingCycleLabel(legacyCycle)} (legacy)</option>
                )}
              </select>
              {errors.billingCycle && (
                <p className="mt-1 text-[11px] text-red-600">{errors.billingCycle}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
              placeholder="What does this plan unlock?"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>

          {/* Price + Duration + Trial + Capacity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Price (₹) *
              </label>
              <input
                type="number"
                min={1}
                step="0.01"
                value={form.price}
                onChange={(e) => setField('price', e.target.value)}
                placeholder="999"
                className={cn(
                  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-900 dark:text-gray-100',
                  errors.price ? 'border-red-400' : 'border-gray-200 dark:border-gray-700',
                )}
              />
              {errors.price && <p className="mt-1 text-[11px] text-red-600">{errors.price}</p>}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Duration (days) *
              </label>
              <input
                type="number"
                min={1}
                value={form.durationDays}
                onChange={(e) => setField('durationDays', e.target.value)}
                className={cn(
                  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-900 dark:text-gray-100',
                  errors.durationDays ? 'border-red-400' : 'border-gray-200 dark:border-gray-700',
                )}
              />
              {errors.durationDays && (
                <p className="mt-1 text-[11px] text-red-600">{errors.durationDays}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Trial Days
              </label>
              <input
                type="number"
                min={0}
                value={form.trialDays}
                onChange={(e) => setField('trialDays', e.target.value)}
                className={cn(
                  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-900 dark:text-gray-100',
                  errors.trialDays ? 'border-red-400' : 'border-gray-200 dark:border-gray-700',
                )}
              />
              {errors.trialDays && <p className="mt-1 text-[11px] text-red-600">{errors.trialDays}</p>}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Max Students (optional)
              </label>
              <input
                type="number"
                min={0}
                value={form.maxStudents}
                onChange={(e) => setField('maxStudents', e.target.value)}
                placeholder="Unlimited"
                className={cn(
                  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-900 dark:text-gray-100',
                  errors.maxStudents ? 'border-red-400' : 'border-gray-200 dark:border-gray-700',
                )}
              />
              {errors.maxStudents && (
                <p className="mt-1 text-[11px] text-red-600">{errors.maxStudents}</p>
              )}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-6 pt-1">
            <label className="flex cursor-pointer items-center gap-2">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={form.isFeatured}
                  onChange={(e) => setField('isFeatured', e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-4 w-8 rounded-full bg-gray-200 transition-colors peer-checked:bg-amber-500 dark:bg-gray-700" />
                <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400">Featured</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setField('isActive', e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-4 w-8 rounded-full bg-gray-200 transition-colors peer-checked:bg-emerald-500 dark:bg-gray-700" />
                <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {mode === 'create' ? 'Active on creation' : 'Active'}
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending && <CircleNotch size={14} className="animate-spin" />}
            {isPending ? 'Saving...' : mode === 'create' ? 'Create Plan' : 'Save Changes'}
          </button>
          <p className="text-[11px] text-gray-400">⌘↵ to submit</p>
        </div>
      </div>
    </div>
  );
}
