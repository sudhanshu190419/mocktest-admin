'use client';

/**
 * ControlBar — Live Studio Control Buttons
 *
 * Renders camera toggle, microphone toggle, and end-class buttons.
 * Uses `useLocalParticipant` from `@livekit/components-react` so it MUST
 * be rendered inside a `<LiveKitRoom>`.
 *
 * @module components/live-studio/ControlBar
 */

import React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Microphone, VideoCamera } from '@phosphor-icons/react';

interface ControlBarProps {
  /** Called when the teacher clicks "End Class". */
  onEndClass: () => void;
}

/**
 * Control bar for a live LiveKit session.
 * Renders camera/mic toggle buttons and an "End Class" button.
 */
export function ControlBar({ onEndClass }: ControlBarProps): React.JSX.Element {
  const {
    isCameraEnabled,
    isMicrophoneEnabled,
    localParticipant,
  } = useLocalParticipant();

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
      </div>

      {/* End Class Button */}
      <button
        onClick={onEndClass}
        className="w-full sm:w-auto px-8 py-4 rounded-full bg-red-600 hover:bg-red-500 text-white font-extrabold text-sm tracking-wide shadow-2xl transition-all"
        aria-label="End class for all students"
      >
        END SESSION & SAVE
      </button>
    </div>
  );
}
