'use client';

import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface MessageComposerProps {
  onSend: (message: string) => void;
  isSending: boolean;
  disabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function MessageComposer({
  onSend,
  isSending,
  disabled = false,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !isSending && !disabled;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(trimmed);
    setText('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [canSend, trimmed, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends the message (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);

      // Auto-resize textarea
      const textarea = e.target;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    },
    [],
  );

  return (
    <div className="flex items-end gap-2 border-t border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className={cn(
            'w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 pr-4 text-sm text-gray-900 placeholder-gray-400',
            'transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20',
            'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500',
            'dark:focus:border-blue-500 dark:focus:bg-gray-950',
            disabled && 'cursor-not-allowed opacity-50',
          )}
          style={{
            minHeight: 42,
            maxHeight: 120,
          }}
        />
      </div>

      {/* Send Button */}
      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className={cn(
          'flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-xl transition-all',
          canSend
            ? 'bg-[#166534] text-white shadow-sm hover:bg-[#14502c] active:scale-95'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
        )}
      >
        {isSending ? (
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
