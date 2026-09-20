'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useConnectionState,
} from '@livekit/components-react';
import { ConnectionState, ConnectionQuality } from 'livekit-client';
import { LiveClassHeader } from './LiveClassHeader';
import { LiveStage } from './LiveStage';
import { LiveClassChatPanel } from './LiveClassChatPanel';
import { LiveClassControls } from './LiveClassControls';
import { ClassEndedState } from './ClassEndedState';
import { ClassConnectionState } from './ClassConnectionState';
import { StudentAskDoubtModal } from '@/components/student/doubts/StudentAskDoubtModal';
import type { AuthorizedLiveClassRoomData } from '@/services/student/studentLiveClassRoomWebService';
import { checkLiveClassStatus } from '@/services/student/studentLiveClassRoomWebService';

interface StudentLiveClassroomProps {
  classData: AuthorizedLiveClassRoomData;
  token: string;
  serverUrl: string;
}

// Inner Classroom component that runs within the LiveKitRoom context
const ClassroomInner: React.FC<{
  classData: AuthorizedLiveClassRoomData;
  onExit: () => void;
}> = ({ classData, onExit }) => {
  const room = useRoomContext();
  const connectionState = useConnectionState();

  const [isChatOpen, setIsChatOpen] = useState<boolean>(true);
  const [isHandRaised, setIsHandRaised] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isClassEnded, setIsClassEnded] = useState<boolean>(false);
  const [isAskDoubtOpen, setIsAskDoubtOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Toggle Hand Raise via LiveKit data channel
  const handleToggleHand = useCallback(async () => {
    const nextState = !isHandRaised;
    setIsHandRaised(nextState);

    if (room && room.state === ConnectionState.Connected) {
      try {
        const payload = JSON.stringify({
          type: 'hand_raise',
          raised: nextState,
          timestamp: Date.now(),
        });
        const encoder = new TextEncoder();
        await room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
      } catch (err) {
        console.warn('[StudentLiveClassroom] Failed to publish hand raise data:', err);
      }
    }
  }, [isHandRaised, room]);

  // Toggle Fullscreen using browser API
  const handleToggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;

    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Listen for fullscreen change events
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Poll class status every 20s to detect if teacher ended the class
  useEffect(() => {
    const interval = setInterval(async () => {
      const { status } = await checkLiveClassStatus(classData.classId);
      if (status === 'completed' || status === 'cancelled') {
        setIsClassEnded(true);
      }
    }, 20000);

    return () => clearInterval(interval);
  }, [classData.classId]);

  if (isClassEnded) {
    return (
      <ClassEndedState
        title={classData.title}
        subjectName={classData.subjectName}
        teacherName={classData.teacherName}
        hasRecording={classData.isRecorded}
      />
    );
  }

  const isReconnecting = connectionState === ConnectionState.Reconnecting;

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-screen max-h-screen bg-ink text-white overflow-hidden select-none"
    >
      {/* Top Header */}
      <LiveClassHeader
        title={classData.title}
        subjectName={classData.subjectName}
        batchName={classData.batchName}
        isLive={true}
        networkQuality={ConnectionQuality.Excellent}
        isReconnecting={isReconnecting}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onLeaveClass={onExit}
      />

      {/* Main Body: Stage + Chat */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 relative overflow-hidden">
        {/* Live Stage Viewport */}
        <main className="flex-1 p-3 sm:p-4 flex items-center justify-center min-h-0 overflow-hidden">
          <LiveStage teacherName={classData.teacherName} />
        </main>

        {/* Live Chat Side Panel */}
        <LiveClassChatPanel
          classId={classData.classId}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          teacherName={classData.teacherName}
        />
      </div>

      {/* Floating Control Bar */}
      <LiveClassControls
        isHandRaised={isHandRaised}
        onToggleHand={handleToggleHand}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((v) => !v)}
        onOpenAskDoubt={() => setIsAskDoubtOpen(true)}
        onLeaveClass={onExit}
      />

      {/* Contextual Ask a Doubt Modal */}
      <StudentAskDoubtModal
        isOpen={isAskDoubtOpen}
        onClose={() => setIsAskDoubtOpen(false)}
        initialContext={{
          batchId: classData.batchId,
          relatedResourceType: 'live_class',
          relatedResourceId: classData.classId,
          prefillTitle: `Doubt regarding live class: ${classData.title}`,
          subjectName: classData.subjectName,
          chapterName: classData.chapterName || undefined,
          topicName: classData.topicName || undefined,
        }}
      />
    </div>
  );
};

export const StudentLiveClassroom: React.FC<StudentLiveClassroomProps> = ({
  classData,
  token,
  serverUrl,
}) => {
  const router = useRouter();

  const handleExit = useCallback(() => {
    router.push('/student/classes');
  }, [router]);

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      video={false}
      audio={false}
      onDisconnected={handleExit}
      className="h-full w-full"
    >
      <RoomAudioRenderer />
      <ClassroomInner classData={classData} onExit={handleExit} />
    </LiveKitRoom>
  );
};
