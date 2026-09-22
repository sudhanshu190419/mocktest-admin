'use client';

/**
 * ControlBar — Live Studio Control Buttons
 *
 * Renders camera toggle, microphone toggle, the teacher's recording control,
 * screen-share toggle, and end-class buttons.
 * Uses `useLocalParticipant` from `@livekit/components-react` so it MUST
 * be rendered inside a `<LiveKitRoom>`.
 *
 * @module components/live-studio/ControlBar
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Microphone, Presentation, VideoCamera, WarningCircle } from '@phosphor-icons/react';
import { RecordingControl } from './RecordingControl';

/** How long a screen-share error notice stays visible (ms). */
const SCREEN_SHARE_NOTICE_MS = 6000;

interface ControlBarProps {
  /** Called when the teacher clicks "End Class" — permanently ends the session in DB. */
  onEndClass: () => void;
  /** Called when the teacher clicks the close/disconnect button — only disconnects from LiveKit. */
  onCloseStudio: () => void;
  /** True while the end RPC is in flight — disables End (prevents double End). */
  isEnding?: boolean;
  /**
   * Live class being recorded. When set, the teacher's Start/Stop recording
   * control is rendered. Omit to hide recording entirely (no live class).
   */
  recordingClassId?: string;
  /** Live class title — used as the recording title. */
  recordingClassTitle?: string;
}

/**
 * Control bar for a live LiveKit session.
 * Renders camera/mic toggle buttons, an "End Session" button,
 * and a close studio link (disconnect-only).
 */
export function ControlBar({ onEndClass, onCloseStudio, isEnding = false, recordingClassId, recordingClassTitle }: ControlBarProps): React.JSX.Element {
  const {
    isCameraEnabled,
    isScreenShareEnabled,
    isMicrophoneEnabled,
    localParticipant,
  } = useLocalParticipant();

  // ── Screen share (toggle + local error notice) ───────────────────────
  //
  // The button's on/off state is derived from `isScreenShareEnabled`, never
  // from local state: when the teacher stops sharing with the browser's native
  // "Stop sharing" control, livekit-client ends and unpublishes the ScreenShare
  // track itself (`isScreenShareEnabled` flips to false), so the button and the
  // studio stage update automatically.
  //
  // Dismissing the browser's screen picker (NotAllowedError / AbortError) is a
  // normal user action, not an application error — it stays silent and never
  // disconnects the teacher.
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [isScreenSharePending, setIsScreenSharePending] = useState(false);
  const screenShareNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (screenShareNoticeTimer.current) clearTimeout(screenShareNoticeTimer.current);
    },
    [],
  );

  const handleToggleScreenShare = useCallback(async () => {
    if (!localParticipant || isScreenSharePending) return;

    setIsScreenSharePending(true);
    try {
      // Must originate from this click handler — getDisplayMedia() requires a
      // user gesture and the browser cannot be asked to share a screen without
      // one.
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } catch (err) {
      const errorName = err instanceof Error ? err.name : '';
      const isPickerCancelled = errorName === 'NotAllowedError' || errorName === 'AbortError';

      if (!isPickerCancelled) {
        if (screenShareNoticeTimer.current) clearTimeout(screenShareNoticeTimer.current);
        setScreenShareError(
          err instanceof Error && err.message
            ? `Could not share your screen: ${err.message}`
            : 'Could not share your screen. Please try again.',
        );
        screenShareNoticeTimer.current = setTimeout(
          () => setScreenShareError(null),
          SCREEN_SHARE_NOTICE_MS,
        );
      }
    } finally {
      setIsScreenSharePending(false);
    }
  }, [localParticipant, isScreenShareEnabled, isScreenSharePending]);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10">
      {/* Media Controls */}
      <div className="flex items-center gap-3">
        {/* Microphone Toggle */}
        <button
          onClick={() => localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            isMicrophoneEnabled
              ? 'bg-white/10 hover:bg-white/20 text-white'
              : 'bg-red-500 text-white'
          }`}
          aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          <Microphone size={22} />
        </button>

        {/* Camera Toggle */}
        <button
          onClick={() => localParticipant?.setCameraEnabled(!isCameraEnabled)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            isCameraEnabled
              ? 'bg-white/10 hover:bg-white/20 text-white'
              : 'bg-red-500 text-white'
          }`}
          aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
        >
          <VideoCamera size={22} />
        </button>

        {/* Screen Share Toggle */}
        <div className="relative flex items-center">
          {/* Local, control-bar-scoped notice (same pattern as RecordingControl) */}
          {screenShareError && (
            <div
              role="status"
              aria-live="polite"
              className="absolute bottom-full left-0 mb-3 flex max-w-xs items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/20 px-3 py-2 text-[11px] font-medium text-red-200 backdrop-blur-md"
            >
              <WarningCircle size={14} weight="bold" aria-hidden="true" />
              <span>{screenShareError}</span>
            </div>
          )}

          <button
            onClick={handleToggleScreenShare}
            disabled={isScreenSharePending}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
              isScreenShareEnabled
                ? 'bg-blue-500/30 text-blue-300 border border-blue-400/40'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            aria-label={isScreenShareEnabled ? 'Stop sharing your screen' : 'Share your screen'}
          >
            <Presentation size={22} />
          </button>
        </div>

        {/* Separator */}
        <div className="h-8 w-px bg-white/10 mx-1" />

        {/* Recording control (teacher-only, live class only) */}
        {recordingClassId && (
          <RecordingControl
            classId={recordingClassId}
            classTitle={recordingClassTitle ?? ''}
          />
        )}

        {/* Close Studio (disconnect only) */}
        <button
          onClick={onCloseStudio}
          className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-white/60 hover:text-white text-xs font-medium transition-all border border-white/10"
          aria-label="Disconnect from LiveKit (session stays live)"
        >
          Exit Studio
        </button>
      </div>

      {/* End Session Button — PERMANENTLY ends the session in DB */}
      <button
        onClick={onEndClass}
        disabled={isEnding}
        className="w-full sm:w-auto px-8 py-4 rounded-full bg-red-600 hover:bg-red-500 text-white font-extrabold text-sm tracking-wide shadow-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="End class for all students — this cannot be undone"
      >
        {isEnding ? 'ENDING…' : 'END SESSION & SAVE'}
      </button>
    </div>
  );
}
