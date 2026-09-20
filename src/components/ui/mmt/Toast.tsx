'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X, CheckCircle, WarningCircle, Info } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  title: string;
  tone: ToastTone;
}

interface ToastContextValue {
  /** Show a toast. Auto-dismisses after 4s. Max 3 visible. */
  toast: (title: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Access the toast function. Safe no-op outside a provider (logs only). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: (title, tone = 'info') => console.log(`[toast:${tone}] ${title}`),
    };
  }
  return ctx;
}

const AUTO_DISMISS_MS = 4000;
const MAX_VISIBLE = 3;

const toneIcon = {
  success: CheckCircle,
  error: WarningCircle,
  info: Info,
} as const;

const toneClasses: Record<ToastTone, string> = {
  success: 'text-mint-ink',
  error: 'text-error',
  info: 'text-sky-ink',
};

/** Design A toast stack (PRD §6): bottom-center on mobile, top-right on
 *  desktop; 4s auto-dismiss; dismissible; max 3 visible. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (title: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, title, tone }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className={cn(
          'pointer-events-none fixed z-[90] flex flex-col gap-2',
          'bottom-4 left-1/2 -translate-x-1/2', // mobile: bottom-center
          'sm:bottom-auto sm:left-auto sm:right-5 sm:top-20 sm:translate-x-0' // desktop: top-right
        )}
      >
        {items.map((t) => {
          const Icon = toneIcon[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                'pointer-events-auto flex w-[min(92vw,360px)] items-center gap-3',
                'rounded-card border border-line bg-surface p-3.5 shadow-dialog'
              )}
            >
              <Icon size={20} weight="duotone" className={cn('shrink-0', toneClasses[t.tone])} aria-hidden="true" />
              <p className="flex-1 text-body font-semibold text-ink">{t.title}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-paper hover:text-ink"
              >
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
