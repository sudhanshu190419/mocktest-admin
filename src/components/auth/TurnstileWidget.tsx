'use client';

import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';

export interface TurnstileWidgetRef {
  resetWidget: () => void;
  resetCaptcha: () => void;
  reset: () => void;
}

export interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact' | 'flexible';
  className?: string;
  action?: string;
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export const TurnstileWidget = forwardRef<TurnstileWidgetRef, TurnstileWidgetProps>(
  function TurnstileWidget(
    { onVerify, onExpire, onError, theme = 'auto', size = 'normal', className = '', action },
    ref
  ) {
    const internalRef = useRef<TurnstileInstance | undefined>(undefined);
    const [loadError, setLoadError] = useState<string | null>(null);

    const reset = () => {
      try {
        internalRef.current?.reset();
      } catch {
        // ignore reset errors on unmounted widget
      }
      setLoadError(null);
    };

    useImperativeHandle(ref, () => ({
      resetWidget: reset,
      resetCaptcha: reset,
      reset: reset,
    }));

    if (!TURNSTILE_SITE_KEY) {
      return (
        <div
          role="alert"
          className="p-3 my-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2"
        >
          <svg className="w-4 h-4 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Security check is temporarily unavailable (missing NEXT_PUBLIC_TURNSTILE_SITE_KEY).</span>
        </div>
      );
    }

    return (
      <div className={`turnstile-container my-2 flex flex-col items-center justify-center ${className}`}>
        {loadError && (
          <div
            role="alert"
            className="w-full p-2.5 mb-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg text-center"
          >
            {loadError}
          </div>
        )}
        <Turnstile
          ref={internalRef}
          siteKey={TURNSTILE_SITE_KEY}
          options={{
            theme,
            size,
            action,
          }}
          onSuccess={(token) => {
            setLoadError(null);
            onVerify(token);
          }}
          onExpire={() => {
            onExpire?.();
          }}
          onError={(error) => {
            const errorMsg =
              typeof error === 'string'
                ? `Security verification error (${error}). Please try again.`
                : 'Security verification failed to load. Please check your internet connection.';
            setLoadError(errorMsg);
            onError?.(errorMsg);
          }}
        />
      </div>
    );
  }
);

TurnstileWidget.displayName = 'TurnstileWidget';

// Backwards-compatible aliases
export const HCaptchaWidget = TurnstileWidget;
export type HCaptchaWidgetRef = TurnstileWidgetRef;
