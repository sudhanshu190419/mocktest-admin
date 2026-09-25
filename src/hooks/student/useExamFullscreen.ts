'use client';

import { useState, useEffect, useCallback } from 'react';

interface FullscreenDoc extends Document {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void>;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

export interface ExamFullscreenState {
  isFullscreen: boolean;
  supportsFullscreen: boolean;
  showFullscreenWarning: boolean;
  enterFullscreen: () => Promise<boolean>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  dismissWarning: () => void;
}

/**
 * Hook to manage exam engine fullscreen lifecycle, exit detection, and cross-browser fallbacks.
 *
 * @param onExitWarning Callback triggered when fullscreen is exited unexpectedly.
 * @param isSubmitted Boolean indicating if test has finished (disables exit warning).
 */
export function useExamFullscreen(
  onExitWarning?: () => void,
  isSubmitted: boolean = false
): ExamFullscreenState {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supportsFullscreen, setSupportsFullscreen] = useState(true);
  const [showFullscreenWarning, setShowFullscreenWarning] = useState(false);

  // Check support on mount
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const docEl = document.documentElement as FullscreenElement;
    const supported = Boolean(
      docEl.requestFullscreen ||
      docEl.webkitRequestFullscreen ||
      (document as FullscreenDoc).fullscreenEnabled
    );
    setSupportsFullscreen(supported);
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFullscreenChange = () => {
      const doc = document as FullscreenDoc;
      const inFullscreen = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      setIsFullscreen(inFullscreen);

      if (!inFullscreen && !isSubmitted) {
        setShowFullscreenWarning(true);
        onExitWarning?.();
      } else {
        setShowFullscreenWarning(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isSubmitted, onExitWarning]);

  const enterFullscreen = useCallback(async (): Promise<boolean> => {
    if (typeof document === 'undefined') return false;
    try {
      const docEl = document.documentElement as FullscreenElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
      setIsFullscreen(true);
      setShowFullscreenWarning(false);
      return true;
    } catch (err) {
      console.warn('[useExamFullscreen] requestFullscreen failed:', err);
      return false;
    }
  }, []);

  const exitFullscreen = useCallback(async (): Promise<void> => {
    if (typeof document === 'undefined') return;
    try {
      const doc = document as FullscreenDoc;
      if (document.fullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      }
      setIsFullscreen(false);
      setShowFullscreenWarning(false);
    } catch (err) {
      console.warn('[useExamFullscreen] exitFullscreen error:', err);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  const dismissWarning = useCallback(() => {
    setShowFullscreenWarning(false);
  }, []);

  return {
    isFullscreen,
    supportsFullscreen,
    showFullscreenWarning,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
    dismissWarning,
  };
}
