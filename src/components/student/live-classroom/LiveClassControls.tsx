'use client';

import React, { useState, useEffect } from 'react';
import { Hand, ChatCircleDots, SignOut, X, Question } from '@phosphor-icons/react';
import { useRoomContext } from '@livekit/components-react';

interface LiveClassControlsProps {
  isHandRaised: boolean;
  onToggleHand: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
  onOpenAskDoubt?: () => void;
  onLeaveClass: () => void;
}

export const LiveClassControls: React.FC<LiveClassControlsProps> = ({
  isHandRaised,
  onToggleHand,
  isChatOpen,
  onToggleChat,
  onOpenAskDoubt,
  onLeaveClass,
}) => {
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);

  useEffect(() => {
    if (!showConfirmLeave) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConfirmLeave(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showConfirmLeave]);

  return (
    <>
      <div className="flex items-center justify-center gap-3 p-3 bg-ink/90 border-t border-ink/80 backdrop-blur-md z-30">
        {/* Raise Hand Button */}
        <button
          type="button"
          onClick={onToggleHand}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-card text-xs font-black transition-all shadow-md active:scale-[0.98] ${
            isHandRaised
              ? 'bg-amber-500 text-ink ring-4 ring-amber-500/30'
              : 'bg-ink hover:bg-ink text-sky-ink border border-ink'
          }`}
          title={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
        >
          <Hand size={16} weight={isHandRaised ? 'fill' : 'bold'} />
          <span>{isHandRaised ? 'Hand Raised' : 'Raise Hand'}</span>
        </button>

        {/* Live Chat Toggle */}
        <button
          type="button"
          onClick={onToggleChat}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-card text-xs font-bold transition-all shadow-md active:scale-[0.98] ${
            isChatOpen
              ? 'bg-brand text-white'
              : 'bg-ink hover:bg-ink text-sky-ink border border-ink'
          }`}
          title="Toggle Chat"
        >
          <ChatCircleDots size={16} weight="bold" />
          <span>Chat</span>
        </button>

        {/* Ask a Doubt Action */}
        {onOpenAskDoubt && (
          <button
            type="button"
            onClick={onOpenAskDoubt}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-card bg-brand/30 hover:bg-brand text-brand hover:text-white border border-brand/40 text-xs font-bold transition-all shadow-md active:scale-[0.98]"
            title="Ask a Doubt"
          >
            <Question size={16} weight="bold" />
            <span>Ask Doubt</span>
          </button>
        )}

        {/* Leave Class */}
        <button
          type="button"
          onClick={() => setShowConfirmLeave(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-card bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-bold transition-all active:scale-[0.98]"
          title="Leave Live Class"
        >
          <SignOut size={16} weight="bold" />
          <span>Leave</span>
        </button>
      </div>

      {/* Leave Confirmation Modal */}
      {showConfirmLeave && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Leave Classroom"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowConfirmLeave(false);
          }}
        >
          <div className="max-w-sm w-full p-6 rounded-sheet bg-ink border border-ink text-center text-white space-y-4 shadow-2xl">
            <h3 className="text-base font-extrabold text-white">Leave Classroom?</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Are you sure you want to exit? You can rejoin anytime while the session is live.
            </p>

            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmLeave(false)}
                className="flex-1 py-2.5 rounded-field bg-ink hover:bg-ink text-ink-muted font-bold text-xs transition-colors"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmLeave(false);
                  onLeaveClass();
                }}
                className="flex-1 py-2.5 rounded-field bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors shadow-md shadow-rose-600/30"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
