'use client';

import React from 'react';
import { VideoTrack, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { User, Microphone } from '@phosphor-icons/react';

interface TeacherVideoTileProps {
  trackRef?: TrackReferenceOrPlaceholder;
  teacherName?: string | null;
  isAudioOnly?: boolean;
}

export const TeacherVideoTile: React.FC<TeacherVideoTileProps> = ({
  trackRef,
  teacherName,
  isAudioOnly,
}) => {
  if (isAudioOnly || !trackRef?.publication) {
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-slate-950 rounded-3xl overflow-hidden border border-slate-800">
        <div className="text-center space-y-4 p-6">
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-indigo-600 to-sky-600 text-white flex items-center justify-center mx-auto shadow-2xl ring-4 ring-white/10">
            <User size={42} weight="bold" />
            <div className="absolute -bottom-1 -right-1 p-2 rounded-full bg-emerald-500 text-white ring-2 ring-slate-950">
              <Microphone size={14} weight="fill" />
            </div>
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-white">{teacherName || 'Instructor'}</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Live Audio Streaming</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center">
      <VideoTrack
        trackRef={trackRef}
        className="w-full h-full object-contain"
      />

      {/* Teacher label overlay */}
      <div className="absolute bottom-4 left-4 z-10 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/80 text-white text-xs font-bold backdrop-blur-md border border-white/10 shadow-lg">
        <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
        <span>{teacherName || 'Instructor'}</span>
      </div>
    </div>
  );
};
