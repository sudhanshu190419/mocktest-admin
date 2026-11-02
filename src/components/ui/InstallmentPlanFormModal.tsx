'use client';

import { useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSubscriptionCourses } from '@/hooks/admin/useSubscriptionAdmin';
import {
  useCreateInstallmentPlan,
  useUpdateInstallmentPlan,
} from '@/hooks/admin/useInstallmentPlanAdmin';
import {
  calculateInstallmentSchedulePreview,
  formatIntervalLabel,
  type InstallmentPlanListItem,
} from '@/services/admin/installmentPlanAdminService';
import { cn } from '@/lib/utils';
import {
  CircleNotch,
  X,
  Lock,
  Info,
  CalendarCheck,
  CheckCircle,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface FormState {
  courseId: string;
  planName: string;
  totalFee: string;
  numberOfInstallments: string;
  intervalMonths: string;
  isActive: boolean;
}

interface FormErrors {
  courseId?: string;
  planName?: string;
  totalFee?: string;
  numberOfInstallments?: string;
  intervalMonths?: string;
  submit?: string;
}

interface InstallmentPlanFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  plan?: InstallmentPlanListItem | null;
  onClose: () => void;
  onSuccess?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants & Helpers
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY_STATE: FormState = {
  courseId: '',
  planName: '',
  totalFee: '',
  numberOfInstallments: '3',
  intervalMonths: '1',
  isActive: true,
};

function stateFromPlan(plan: InstallmentPlanListItem): FormState {
  return {
    courseId: plan.courseId ?? '',
    planName: plan.planName,
    totalFee: String(plan.totalFee),
    numberOfInstallments: String(plan.numberOfInstallments),
    intervalMonths: String(plan.intervalMonths),
    isActive: plan.isActive,
  };
}

const COMMON_INTERVAL_PRESETS = [
  { value: '1', label: '1 Month (Monthly)' },
  { value: '2', label: '2 Months (Bi-Monthly)' },
  { value: '3', label: '3 Months (Quarterly)' },
  { value: '6', label: '6 Months (Half-Yearly)' },
];

const COMMON_INSTALLMENT_PRESETS = ['2', '3', '4', '6', '12'];

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function InstallmentPlanFormModal({
  open,
  mode,
  plan,
  onClose,
  onSuccess,
}: InstallmentPlanFormModalProps) {
  const { instituteId } = useAuth();
  const { data: courses, isLoading: coursesLoading } = useSubscriptionCourses(instituteId);

  const [form, setForm] = useState<FormState>(() =>
    plan && mode === 'edit' ? stateFromPlan(plan) : EMPTY_STATE,
  );
  const [errors, setErrors] = useState<FormErrors>({});

  const createMutation = useCreateInstallmentPlan();
  const updateMutation = useUpdateInstallmentPlan();
  const isPending = createMutation.isPending || updateMutation.isPending;

  // Protected references: When student agreements or orders reference this plan, financial terms are immutable.
  const isFinancialTermsLocked = useMemo(() => {
    return mode === 'edit' && Boolean(plan && ((plan.agreementsCount ?? 0) > 0 || ((plan as any)?.ordersCount ?? 0) > 0));
  }, [mode, plan]);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, submit: undefined }));
  }, []);

  // Compute live installment preview based on current form values
  const schedulePreview = useMemo(() => {
    const fee = Number(form.totalFee);
    const n = Number(form.numberOfInstallments);
    const interval = Number(form.intervalMonths);
    if (fee > 0 && n > 0 && interval > 0) {
      return calculateInstallmentSchedulePreview(fee, n, interval);
    }
    return [];
  }, [form.totalFee, form.numberOfInstallments, form.intervalMonths]);

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!form.courseId) {
      next.courseId = 'Please select a course.';
    }
    if (!form.planName.trim() || form.planName.trim().length < 2) {
      next.planName = 'Plan name must be at least 2 characters.';
    }
    const fee = Number(form.totalFee);
    if (!form.totalFee || Number.isNaN(fee) || fee <= 0) {
      next.totalFee = 'Total fee must be a positive amount greater than 0.';
    }
    const installments = Number(form.numberOfInstallments);
    if (
      !form.numberOfInstallments ||
      Number.isNaN(installments) ||
      !Number.isInteger(installments) ||
      installments < 1 ||
      installments > 32767
    ) {
      next.numberOfInstallments = 'Number of installments must be a positive integer (min 1).';
    }
    const interval = Number(form.intervalMonths);
    if (
      !form.intervalMonths ||
      Number.isNaN(interval) ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > 32767
    ) {
      next.intervalMonths = 'Interval must be a positive integer in months (min 1).';
    }
    return next;
  };

  const handleSubmit = async () => {
    const validation = validate();
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    if (mode === 'create') {
      const result = await createMutation.mutateAsync({
        courseId: form.courseId,
        planName: form.planName.trim(),
        totalFee: Number(form.totalFee),
        numberOfInstallments: Math.floor(Number(form.numberOfInstallments)),
        intervalMonths: Math.floor(Number(form.intervalMonths)),
        isActive: form.isActive,
      });

      if (!result.success) {
        setErrors({ submit: result.error ?? 'Failed to create installment plan.' });
        return;
      }
    } else if (plan) {
      // In edit mode: if financial terms are locked, only send non-financial fields.
      const payload = isFinancialTermsLocked
        ? {
            planName: form.planName.trim(),
            isActive: form.isActive,
          }
        : {
            courseId: form.courseId,
            planName: form.planName.trim(),
            totalFee: Number(form.totalFee),
            numberOfInstallments: Math.floor(Number(form.numberOfInstallments)),
            intervalMonths: Math.floor(Number(form.intervalMonths)),
            isActive: form.isActive,
          };

      const result = await updateMutation.mutateAsync({
        planId: plan.planId,
        input: payload,
      });

      if (!result.success) {
        let errMessage = result.error ?? 'Failed to update installment plan.';
        if (errMessage.includes('23514') || errMessage.toLowerCase().includes('cannot modify financial parameters')) {
          errMessage = 'Financial terms cannot be modified because student agreements or active orders reference this plan. Please deactivate this plan and create a new one.';
        }
        setErrors({ submit: errMessage });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="installment-plan-modal-title"
        className="relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl animate-[fadeIn_200ms_ease-out] dark:border-gray-800 dark:bg-gray-950"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div>
            <h2
              id="installment-plan-modal-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              {mode === 'create' ? 'Create Installment Plan' : 'Edit Installment Plan'}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {mode === 'create'
                ? 'Set up milestone fee tranches and payment intervals for a course.'
                : 'Modify plan name and active status. Financial terms are guarded by Migration 221.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Migration 221 Immutability Notice Banner */}
          {isFinancialTermsLocked && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
              <Lock size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">Financial Terms Locked (Protected References)</p>
                <p className="mt-1 leading-relaxed">
                  This plan is currently referenced by{' '}
                  <span className="font-bold underline">
                    {plan?.agreementsCount ?? 0} student agreement
                    {(plan?.agreementsCount ?? 0) === 1 ? '' : 's'}
                    {((plan as any)?.ordersCount ?? 0) > 0 ? ` and ${(plan as any).ordersCount} order(s)` : ''}
                  </span>
                  . Course, Total Fee, Number of Installments, and Interval are immutable to prevent silent financial alterations.
                  To introduce different fees or installment terms, deactivate this plan and create a new plan.
                </p>
              </div>
            </div>
          )}

          {/* Top Error Message */}
          {errors.submit && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              <p className="font-semibold">Failed to save installment plan</p>
              <p className="mt-0.5">{errors.submit}</p>
            </div>
          )}

          {/* Course Selection */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
              Course <span className="text-red-500">*</span>
              {isFinancialTermsLocked && <Lock size={12} className="text-amber-500" />}
            </label>
            <select
              disabled={isFinancialTermsLocked || coursesLoading}
              value={form.courseId}
              onChange={(e) => setField('courseId', e.target.value)}
              className={cn(
                'mt-1.5 block w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                'border-gray-200 bg-white text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20',
                'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100',
                isFinancialTermsLocked && 'cursor-not-allowed bg-gray-50 text-gray-500 dark:bg-gray-900/60 dark:text-gray-500',
                errors.courseId && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
              )}
            >
              <option value="">Select a course...</option>
              {(courses ?? []).map((course) => (
                <option key={course.courseId} value={course.courseId}>
                  {course.title}
                </option>
              ))}
            </select>
            {errors.courseId && (
              <p className="mt-1 text-xs text-red-500">{errors.courseId}</p>
            )}
          </div>

          {/* Plan Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Plan Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 3-Tranche Milestone Plan"
              value={form.planName}
              onChange={(e) => setField('planName', e.target.value)}
              className={cn(
                'mt-1.5 block w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                'border-gray-200 bg-white text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20',
                'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100',
                errors.planName && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
              )}
            />
            {errors.planName && (
              <p className="mt-1 text-xs text-red-500">{errors.planName}</p>
            )}
          </div>

          {/* Grid: Total Fee & Number of Installments */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Total Course Fee */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                Total Course Fee (₹) <span className="text-red-500">*</span>
                {isFinancialTermsLocked && <Lock size={12} className="text-amber-500" />}
              </label>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-medium text-gray-400">
                  ₹
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  disabled={isFinancialTermsLocked}
                  placeholder="10000.00"
                  value={form.totalFee}
                  onChange={(e) => setField('totalFee', e.target.value)}
                  className={cn(
                    'block w-full rounded-xl border pl-8 pr-3.5 py-2.5 text-sm transition-colors',
                    'border-gray-200 bg-white text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20',
                    'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100',
                    isFinancialTermsLocked && 'cursor-not-allowed bg-gray-50 text-gray-500 dark:bg-gray-900/60 dark:text-gray-500',
                    errors.totalFee && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
                  )}
                />
              </div>
              {errors.totalFee && (
                <p className="mt-1 text-xs text-red-500">{errors.totalFee}</p>
              )}
            </div>

            {/* Number of Installments */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                Installment Tranches <span className="text-red-500">*</span>
                {isFinancialTermsLocked && <Lock size={12} className="text-amber-500" />}
              </label>
              <input
                type="number"
                min="1"
                max="36"
                disabled={isFinancialTermsLocked}
                placeholder="3"
                value={form.numberOfInstallments}
                onChange={(e) => setField('numberOfInstallments', e.target.value)}
                className={cn(
                  'mt-1.5 block w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                  'border-gray-200 bg-white text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20',
                  'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100',
                  isFinancialTermsLocked && 'cursor-not-allowed bg-gray-50 text-gray-500 dark:bg-gray-900/60 dark:text-gray-500',
                  errors.numberOfInstallments && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
                )}
              />
              {!isFinancialTermsLocked && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {COMMON_INSTALLMENT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setField('numberOfInstallments', preset)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                        form.numberOfInstallments === preset
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
                      )}
                    >
                      {preset}x
                    </button>
                  ))}
                </div>
              )}
              {errors.numberOfInstallments && (
                <p className="mt-1 text-xs text-red-500">{errors.numberOfInstallments}</p>
              )}
            </div>
          </div>

          {/* Interval in Months */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
              Interval Between Installments <span className="text-red-500">*</span>
              {isFinancialTermsLocked && <Lock size={12} className="text-amber-500" />}
            </label>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                disabled={isFinancialTermsLocked}
                value={form.intervalMonths}
                onChange={(e) => setField('intervalMonths', e.target.value)}
                className={cn(
                  'block w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                  'border-gray-200 bg-white text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20',
                  'dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100',
                  isFinancialTermsLocked && 'cursor-not-allowed bg-gray-50 text-gray-500 dark:bg-gray-900/60 dark:text-gray-500',
                  errors.intervalMonths && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
                )}
              >
                {COMMON_INTERVAL_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                <CalendarCheck size={16} className="mr-1.5 text-amber-500" />
                <span>Cadence: {formatIntervalLabel(Number(form.intervalMonths) || 1)}</span>
              </div>
            </div>
            {errors.intervalMonths && (
              <p className="mt-1 text-xs text-red-500">{errors.intervalMonths}</p>
            )}
          </div>

          {/* Dynamic Schedule Preview (Migration 221 Rounding Reconciliation) */}
          {schedulePreview.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-900/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
                  <Info size={15} className="text-amber-600 dark:text-amber-400" />
                  <span>Installment Schedule Preview (Exact Rounding)</span>
                </div>
                <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                  Total: ₹{Number(form.totalFee).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                Tranches 1 through {schedulePreview.length - 1} use standard rounding. The final tranche
                absorbs any fractional remainder so the schedule sums exactly to the course fee.
              </p>

              <div className="mt-3 space-y-1.5">
                {schedulePreview.map((tranche) => (
                  <div
                    key={tranche.index}
                    className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-1.5 text-xs dark:border-gray-800 dark:bg-gray-900"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      Tranche {tranche.index}
                      {tranche.index === 1 ? ' (Due at Enrollment)' : ` (+${tranche.monthOffset} mo)`}
                    </span>
                    <div className="flex items-center gap-2 font-mono font-medium text-gray-900 dark:text-gray-100">
                      <span>₹{tranche.amountDue.toFixed(2)}</span>
                      {tranche.isRemainderAbsorber && (
                        <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          Remainder Absorber
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Status Switch */}
          <div className="flex items-center justify-between rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div>
              <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                Plan Active Status
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                Active plans are visible to students at course checkout (per Migration 220). Inactive
                plans are hidden from students but preserve all existing agreements.
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setField('isActive', e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-700 dark:bg-gray-800"></div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isPending}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors',
              'hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20',
              isPending && 'cursor-not-allowed opacity-70',
            )}
          >
            {isPending && <CircleNotch size={14} className="animate-spin" />}
            {mode === 'create' ? 'Create Installment Plan' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
