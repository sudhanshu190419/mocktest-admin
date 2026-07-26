/**
 * Recording Slice
 *
 * Redux Toolkit slice managing recording-related **client-side** state.
 *
 * ## Scope
 *
 * This slice tracks ephemeral UI concerns that are NOT cached by React Query:
 *
 * - **Active recording** — the recording currently being captured in the
 *   teacher's current session. Used by the Live Studio to show a recording
 *   indicator and the "Stop Recording" button.
 * - **Playback state** — the current state of the video player (playing,
 *   paused, buffering, error). Used by the student playback screen.
 * - **Share dialog** — whether the "Share Recording" dialog is open and
 *   which recording it targets.
 * - **Transient errors** — UI-level errors that auto-clear after a timeout.
 *
 * ## What this slice does NOT store
 *
 * - Recording list data → React Query cache (`useRecordings` hook)
 * - Recording details → React Query cache (`useRecording` hook)
 * - Recording status polls → React Query cache (`useRecordingStatus` hook)
 * - Playback URLs → React Query cache (`usePlaybackUrl` hook)
 *
 * React Query handles all server state. This slice only handles ephemeral
 * client-side UI state that doesn't belong in the server cache.
 *
 * @module store/recordingSlice
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Represents a recording that is currently being captured.
 */
export interface ActiveRecording {
  /** The recording UUID. */
  recordingId: string;
  /** The source live class UUID. */
  classId: string;
  /** Current status (always `recording` when active). */
  status: 'recording' | 'processing';
  /** ISO 8601 timestamp when recording started. */
  startedAt: string;
}

/**
 * Playback state for the video player component.
 */
export type PlaybackState =
  | 'idle'       // No recording loaded
  | 'loading'    // Buffering / loading URL
  | 'playing'    // Actively playing
  | 'paused'     // User paused
  | 'buffering'  // Network buffering
  | 'error';     // Playback error

/**
 * Shape of the recording UI state in the Redux store.
 */
export interface RecordingUIState {
  /** The recording currently being captured (teacher session). */
  activeRecording: ActiveRecording | null;

  /** Current playback state for the video player. */
  playbackState: PlaybackState;

  /** Transient UI error (auto-cleared after 4 seconds). */
  error: string | null;

  /** Whether the "Share Recording" dialog is open. */
  shareDialogOpen: boolean;

  /** The recording ID being shared. */
  shareRecordingId: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Initial State
// ═══════════════════════════════════════════════════════════════════════════

const initialState: RecordingUIState = {
  activeRecording: null,
  playbackState: 'idle',
  error: null,
  shareDialogOpen: false,
  shareRecordingId: null,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Slice
// ═══════════════════════════════════════════════════════════════════════════

const recordingSlice = createSlice({
  name: 'recording',
  initialState,
  reducers: {
    // ─── Active Recording ─────────────────────────────────────────────

    /**
     * Set the currently active recording (teacher started recording).
     */
    setActiveRecording(state, action: PayloadAction<ActiveRecording | null>) {
      state.activeRecording = action.payload;
    },

    /**
     * Clear the active recording (recording stopped or ended).
     */
    clearActiveRecording(state) {
      state.activeRecording = null;
    },

    // ─── Playback State ───────────────────────────────────────────────

    /**
     * Update the video player playback state.
     */
    setPlaybackState(state, action: PayloadAction<PlaybackState>) {
      state.playbackState = action.payload;
    },

    // ─── Error Handling ───────────────────────────────────────────────

    /**
     * Set a transient UI error.
     */
    setRecordingError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },

    /**
     * Clear the current UI error.
     */
    clearRecordingError(state) {
      state.error = null;
    },

    // ─── Share Dialog ─────────────────────────────────────────────────

    /**
     * Open the share recording dialog for the given recording.
     */
    openShareDialog(state, action: PayloadAction<string>) {
      state.shareDialogOpen = true;
      state.shareRecordingId = action.payload;
    },

    /**
     * Close the share recording dialog.
     */
    closeShareDialog(state) {
      state.shareDialogOpen = false;
      state.shareRecordingId = null;
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════
//  Actions
// ═══════════════════════════════════════════════════════════════════════════

export const {
  setActiveRecording,
  clearActiveRecording,
  setPlaybackState,
  setRecordingError,
  clearRecordingError,
  openShareDialog,
  closeShareDialog,
} = recordingSlice.actions;

// ═══════════════════════════════════════════════════════════════════════════
//  Selectors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Select the currently active recording (if any).
 */
export const selectActiveRecording = (state: { recording: RecordingUIState }) =>
  state.recording.activeRecording;

/**
 * Select the current video player playback state.
 */
export const selectPlaybackState = (state: { recording: RecordingUIState }) =>
  state.recording.playbackState;

/**
 * Select the current transient UI error.
 */
export const selectRecordingError = (state: { recording: RecordingUIState }) =>
  state.recording.error;

/**
 * Select the share dialog state (open/closed + target recording ID).
 */
export const selectShareDialog = (state: { recording: RecordingUIState }) => ({
  open: state.recording.shareDialogOpen,
  recordingId: state.recording.shareRecordingId,
});

// ═══════════════════════════════════════════════════════════════════════════
//  Reducer
// ═══════════════════════════════════════════════════════════════════════════

export default recordingSlice.reducer;
