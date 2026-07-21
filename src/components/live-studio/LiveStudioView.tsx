'use client';

/**
 * LiveStudioView — LiveKit-Powered Teacher Live Studio
 *
 * A full-screen modal that replaces the previous `getUserMedia`-only
 * simulation.  It has two main states:
 *
 * 1. **Pre-Broadcast (Preview)** — local camera preview via `getUserMedia`.
 *    Teacher can toggle camera/mic before going live.
 *
 * 2. **Live** — `<LiveKitRoom>` from `@livekit/components-react` handles
 *    the WebRTC connection.  Camera/mic are published automatically.
 *    The `ControlBar` (rendered inside `LiveKitRoom`) manages toggles and
 *    "End Class".
 *
 * ── Flow ──
 *   Preview ──[Go Live]──▸ Loading ──[LiveKit connects]──▸ Live ──[End]──▸ Ended → Close
 *
 * @module components/live-studio/LiveStudioView
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import {
  X,
  Users,
  Record as RecordIcon,
  VideoCamera,
  Microphone,
  CircleNotch,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';

import { useLiveClass } from '@/hooks/useLiveClass';
import StartLiveDialog from './StartLiveDialog';
import { ControlBar } from './ControlBar';

// ─── Props ─────────────────────────────────────────────────────────────────

interface LiveStudioViewProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Called when the modal should close (after end-class completes). */
  onClose: () => void;
  /**
   * When set, LiveStudioView operates in "Scheduled Class" mode.
   * It calls startScheduledClass(classId) instead of showing StartLiveDialog,
   * preserving the existing live_classes record.
   */
  scheduledClassId?: string;
  /** Optional callback after a scheduled class goes live — parent can refresh its list. */
  onLiveClassStarted?: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * Full-screen Live Studio modal.
 *
 * Manages camera preview, Go Live, LiveKit connection, and End Class.
 */
export function LiveStudioView({ isOpen, onClose, scheduledClassId, onLiveClassStarted }: LiveStudioViewProps): React.JSX.Element | null {
  const { teacherProfile, isDemoMode } = useAuth();

  const teacherId = teacherProfile?.id || 'demo-teacher';
  const teacherName = teacherProfile?.name || 'Dr. Arvind Sharma';
  const [showStartDialog, setShowStartDialog] = useState(false);

  const { state, startClass, startScheduledClass, endClass, reset } = useLiveClass(teacherId, teacherName);

  // ── If scheduledClassId is provided, auto-start when studio opens ──
  const hasAutoStarted = useRef(false);
  useEffect(() => {
    if (scheduledClassId && isOpen && state.status === 'idle' && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startScheduledClass(scheduledClassId).then(() => {
        onLiveClassStarted?.();
      });
    }
    // Reset flag when studio closes
    if (!isOpen) {
      hasAutoStarted.current = false;
    }
  }, [scheduledClassId, isOpen, state.status, startScheduledClass, onLiveClassStarted]);

  // ── Local Media Preview (getUserMedia) ───────────────────────────────
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isPreviewMicOn, setIsPreviewMicOn] = useState(true);
  const [isPreviewCamOn, setIsPreviewCamOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStartedRef = useRef(false);

  // Start/stop camera preview when modal opens/closes
  useEffect(() => {
    if (!isOpen) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    const startPreview = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setLocalStream(stream);
        previewStartedRef.current = true;
      } catch (err) {
        console.warn('[LiveStudio] Camera/mic preview unavailable:', err);
      }
    };

    startPreview();

    return () => {
      cancelled = true;
      previewStartedRef.current = false;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setLocalStream(null);
    };
  }, [isOpen]);

  // Attach local stream to <video> element
  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // ── Preview Media Toggles (before Go Live) ──────────────────────────

  const togglePreviewMic = useCallback(() => {
    const next = !isPreviewMicOn;
    setIsPreviewMicOn(next);
    localStream?.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
  }, [isPreviewMicOn, localStream]);

  const togglePreviewCam = useCallback(() => {
    const next = !isPreviewCamOn;
    setIsPreviewCamOn(next);
    localStream?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
  }, [isPreviewCamOn, localStream]);

  // ── Close Handler ───────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (state.status === 'live') {
      // End class, then close after DB update
      endClass().then(() => {
        if (isMountedRef.current) {
          reset();
          onClose();
        }
      });
    } else {
      reset();
      onClose();
    }
  }, [state.status, endClass, reset, onClose]);

  // ── Go Live button click: scheduled or instant ────────────────────

  const handleGoLiveClick = useCallback(() => {
    if (scheduledClassId) {
      // Mode B: Start the pre-scheduled class directly
      startScheduledClass(scheduledClassId).then(() => {
        onLiveClassStarted?.();
      });
    } else {
      // Mode A: Show StartLiveDialog for Instant Go Live
      setShowStartDialog(true);
    }
  }, [scheduledClassId, startScheduledClass, onLiveClassStarted]);

  // ── Track mounted state for safe async operations ─────────────────
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      reset();
    };
  }, [reset]);

  // ── Guard: not open ─────────────────────────────────────────────────

  if (!isOpen) return null;

  // ── Data ──────────────────────────────────────────────────────────────

  const classTitle = state.title;
  const isLoading = state.status === 'loading';
  const isLive = state.status === 'live';
  const isEnding = state.status === 'ending' || state.status === 'ended';
  const showPreview = state.status === 'idle' || state.status === 'ended';

  // ── Video Stage: renders camera tracks via LiveKit Components ──────────

  /**
   * Renders all active camera tracks inside the video stage.
   *
   * Uses `useTracks` (LiveKit hook) which reactively provides track references
   * as participants publish/unpublish their cameras.  When a track is disabled
   * the array empties and the placeholder icon appears automatically.
   *
   * This component MUST be rendered inside `<LiveKitRoom>` so the hook
   * can access Room context.
   */
  function VideoStageContent(): React.JSX.Element {
    const cameraTracks = useTracks([Track.Source.Camera]);

    if (cameraTracks.length === 0) {
      return (
        <div className="absolute inset-0 flex items-center justify-center text-blue-200/40 pointer-events-none">
          <VideoCamera size={64} weight="thin" />
        </div>
      );
    }

    const trackCount = cameraTracks.length;

    return (
      <div className="absolute inset-0 flex flex-wrap items-stretch">
        {cameraTracks.map((trackRef) => (
          <div
            key={`${trackRef.participant.identity}-${trackRef.source}`}
            className={`flex-1 min-w-0 ${trackCount > 1 ? 'min-w-[50%]' : ''}`}
           style={{ minHeight: 0 }}>
            <div style={{ width: '100%', height: '100%' }}>
              <VideoTrack
                trackRef={trackRef}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  // ── Live mode: wrap everything in LiveKitRoom ───────────────────────
  if (isLive && state.token && state.serverUrl) {
    return (
      <LiveKitRoom
        serverUrl={state.serverUrl}
        token={state.token}
        connect={true}
        video={true}
        audio={true}
        className="fixed inset-0 z-50 bg-navy-800/90 backdrop-blur-xl flex flex-col p-6 sm:p-10 animate-fadeIn text-white"
        onDisconnected={() => {
          if (isMountedRef.current && state.status === 'live') {
            endClass();
          }
        }}
      >
        {/* Audio from remote participants */}
        <RoomAudioRenderer />

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-white/10 pb-6 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-3.5 h-3.5 rounded-full bg-red-500 animate-ping" />
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-blue-300/80">
                • LIVE ON AIR
              </span>
              <h3 className="text-xl font-bold tracking-tight mt-0.5">{classTitle}</h3>
              {state.roomName && (
                <span className="text-[10px] font-mono text-blue-300/60 mt-0.5 block">
                  Room: {state.roomName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-4 py-2 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-mono text-xs font-bold flex items-center gap-2">
              <RecordIcon size={16} weight="fill" className="text-red-500 animate-pulse" />
              <span>LIVE</span>
            </div>
            <button
              onClick={handleClose}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Video Stage ── */}
        <div className="flex-1 my-6 rounded-[2.5rem] bg-black/40 border border-white/10 relative overflow-hidden flex items-center justify-center shadow-2xl">
          {/* Camera tracks rendered by LiveKit Components */}
          <VideoStageContent />

          {/* Overlay: teacher name + room */}
          <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-xs">
            <p className="font-bold">{teacherName} (Host)</p>
            <p className="text-[10px] text-blue-200/80 font-mono mt-0.5">
              {state.roomName ? `Room: ${state.roomName}` : 'LiveKit • Connected'}
            </p>
          </div>

          {/* Top-left: student count */}
          <div className="absolute top-6 left-6 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-xs font-mono flex items-center gap-2">
            <Users size={16} className="text-blue-400" />
            <span>48 Enrolled</span>
          </div>

          {/* Connection error banner (LiveKitRoom may render this if connect fails) */}
          {state.error && (
            <div className="absolute top-6 right-6 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-medium max-w-xs">
              {state.error}
            </div>
          )}
        </div>

        {/* ── Control Bar (inside LiveKitRoom for useLocalParticipant) ── */}
        <ControlBar onEndClass={endClass} />
      </LiveKitRoom>
    );
  }

  // ── Preview / Ended / Loading mode ──────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-navy-800/90 backdrop-blur-xl flex flex-col justify-between p-6 sm:p-10 animate-fadeIn text-white">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-white/10 pb-6 shrink-0">
        <div className="flex items-center gap-4">
          <div
            className={`w-3.5 h-3.5 rounded-full ${
              isEnding ? 'bg-slate-400' : 'bg-amber-400'
            }`}
          />
          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-blue-300/80">
              {isEnding
                ? '• SESSION ENDED'
                : isLoading
                ? '• CONNECTING TO STUDIO...'
                : '• PRE-BROADCAST'}
            </span>
            <h3 className="text-xl font-bold tracking-tight mt-0.5">{classTitle}</h3>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleClose}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 my-6 rounded-[2.5rem] bg-black/40 border border-white/10 relative overflow-hidden flex items-center justify-center shadow-2xl">
        {isLoading ? (
          /* ── Loading Spinner ── */
          <div className="text-center">
            <CircleNotch size={48} className="animate-spin text-amber-400 mx-auto mb-4" />
            <p className="text-sm font-medium text-blue-200/80">
              Connecting to broadcast server…
            </p>
          </div>
        ) : isEnding ? (
          /* ── End State ── */
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-slate-700/60 flex items-center justify-center mx-auto mb-4">
              <VideoCamera size={36} className="text-slate-400" />
            </div>
            <p className="text-lg font-bold text-white">Session Ended</p>
            <p className="text-sm text-blue-200/60 mt-1">
              Attendance and recording are being saved.
            </p>
          </div>
        ) : showPreview ? (
          /* ── Camera Preview ── */
          <>
            {isPreviewCamOn && localStream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center text-slate-400">
                <VideoCamera size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">Camera Off</p>
              </div>
            )}

            {/* Overlay: teacher name */}
            <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-xs">
              <p className="font-bold">{teacherName} (Host)</p>
              <p className="text-[10px] text-blue-200/80 font-mono mt-0.5">Preview • Not Live Yet</p>
            </div>

            {/* Top-left: student count */}
            <div className="absolute top-6 left-6 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-xs font-mono flex items-center gap-2">
              <Users size={16} className="text-blue-400" />
              <span>48 Enrolled</span>
            </div>
          </>
        ) : null}

        {/* Error display */}
        {state.error && (
          <div className="absolute top-6 right-6 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-medium max-w-xs">
            {state.error}
          </div>
        )}
      </div>

      {/* ── Control Bar ── */}
      {!scheduledClassId && showPreview && !isEnding && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10 shrink-0">
          {/* Preview controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePreviewMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                isPreviewMicOn
                  ? 'bg-white/10 hover:bg-white/20 text-white'
                  : 'bg-red-500 text-white'
              }`}
              aria-label={isPreviewMicOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              <Microphone size={22} />
            </button>
            <button
              onClick={togglePreviewCam}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                isPreviewCamOn
                  ? 'bg-white/10 hover:bg-white/20 text-white'
                  : 'bg-red-500 text-white'
              }`}
              aria-label={isPreviewCamOn ? 'Turn camera off' : 'Turn camera on'}
            >
              <VideoCamera size={22} />
            </button>
          </div>

          {/* Go Live button */}
          <button
            onClick={handleGoLiveClick}
            disabled={isLoading}
            className="w-full sm:w-auto px-8 py-4 rounded-full bg-amber-400 hover:bg-amber-300 disabled:bg-amber-400/50 disabled:cursor-not-allowed text-slate-900 font-extrabold text-sm tracking-wide shadow-2xl transition-all"
          >
            {isLoading ? 'CONNECTING...' : 'GO LIVE'}
          </button>
        </div>
      )}

      {/* Ended state — just a close button */}
      {isEnding && (
        <div className="flex justify-center pt-4 border-t border-white/10 shrink-0">
          <button
            onClick={handleClose}
            className="px-8 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-sm transition-all"
          >
            CLOSE STUDIO
          </button>
        </div>
      )}
      {/* Start Live Dialog — only shown in Instant Go Live mode (no scheduledClassId) */}
      {!scheduledClassId && showStartDialog && (
        <StartLiveDialog
          teacherId={teacherId}
          onStart={(selections) => {
            setShowStartDialog(false);
            startClass(selections);
          }}
          onCancel={() => setShowStartDialog(false)}
        />
      )}
    </div>
  );
}