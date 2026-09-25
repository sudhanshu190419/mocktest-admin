'use client';

import React from 'react';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { TeacherVideoTile } from './TeacherVideoTile';
import { ScreenShareTile } from './ScreenShareTile';

interface LiveStageProps {
  teacherName?: string | null;
}

export const LiveStage: React.FC<LiveStageProps> = ({ teacherName }) => {
  // Query camera and screen share tracks from remote teacher
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: false },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  const screenShareTrack = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const cameraTrack = tracks.find((t) => t.source === Track.Source.Camera);

  // If teacher shares screen, prioritize screen as full stage and camera in picture-in-picture
  if (screenShareTrack) {
    return (
      <div className="relative w-full h-full min-h-[400px] lg:min-h-[520px]">
        <ScreenShareTile trackRef={screenShareTrack} />

        {cameraTrack && (
          <div className="absolute top-4 right-4 w-44 sm:w-56 aspect-video z-20 shadow-2xl rounded-card overflow-hidden ring-2 ring-white/20 border border-ink">
            <TeacherVideoTile trackRef={cameraTrack} teacherName={teacherName} />
          </div>
        )}
      </div>
    );
  }

  // Camera only
  return (
    <div className="relative w-full h-full min-h-[400px] lg:min-h-[520px]">
      <TeacherVideoTile
        trackRef={cameraTrack}
        teacherName={teacherName}
        isAudioOnly={!cameraTrack}
      />
    </div>
  );
};
