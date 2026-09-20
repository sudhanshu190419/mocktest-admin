'use client';

import React from 'react';
import { VideoTrack, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Presentation } from '@phosphor-icons/react';

interface ScreenShareTileProps {
  trackRef: TrackReferenceOrPlaceholder;
}

export const ScreenShareTile: React.FC<ScreenShareTileProps> = ({ trackRef }) => {
  return (
    <div className="relative w-full h-full bg-ink rounded-3xl overflow-hidden border border-ink shadow-2xl flex items-center justify-center">
      <VideoTrack
        trackRef={trackRef as any}
        className="w-full h-full object-contain"
      />

      {/* Screen share badge */}
      <div className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ink/80 text-sky-ink text-xs font-bold backdrop-blur-md border border-white/10 shadow-lg">
        <Presentation size={15} weight="bold" />
        <span>Instructor Screen Share</span>
      </div>
    </div>
  );
};
