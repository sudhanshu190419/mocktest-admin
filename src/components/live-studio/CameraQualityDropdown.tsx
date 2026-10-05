'use client';

/**
 * CameraQualityDropdown — Teacher Camera Broadcast Quality Selector
 *
 * Provides a clean [ 1080p FHD ▼ ] dropdown menu allowing the teacher to
 * switch between 1080p Full HD (default) and 720p HD (fallback).
 *
 * @module components/live-studio/CameraQualityDropdown
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CaretDown, Check, CircleNotch, Sparkle } from '@phosphor-icons/react';
import { CameraQuality, CAMERA_QUALITY_CONFIGS } from '@/lib/livekit/cameraQuality';

interface CameraQualityDropdownProps {
  quality: CameraQuality;
  onSelectQuality: (quality: CameraQuality) => void;
  isChanging?: boolean;
  disabled?: boolean;
}

export function CameraQualityDropdown({
  quality,
  onSelectQuality,
  isChanging = false,
  disabled = false,
}: CameraQualityDropdownProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    (target: CameraQuality) => {
      setIsOpen(false);
      if (target !== quality) {
        onSelectQuality(target);
      }
    },
    [onSelectQuality, quality],
  );

  const currentConfig = CAMERA_QUALITY_CONFIGS[quality] ?? CAMERA_QUALITY_CONFIGS['1080p'];

  return (
    <div ref={containerRef} className="relative inline-flex items-center shrink-0">
      {/* Trigger Button: [ 1080p FHD ▼ ] */}
      <button
        type="button"
        onClick={() => !isChanging && !disabled && setIsOpen((prev) => !prev)}
        disabled={isChanging || disabled}
        className={`h-12 px-4 rounded-full text-xs font-mono font-bold transition-all border flex items-center gap-2 shadow-lg select-none ${
          quality === '1080p'
            ? 'bg-blue-600/30 hover:bg-blue-600/40 text-blue-100 border-blue-400/50 ring-1 ring-blue-400/30'
            : 'bg-white/10 hover:bg-white/20 text-white/90 border-white/20'
        } ${isChanging ? 'opacity-60 cursor-wait' : 'cursor-pointer active:scale-95'}`}
        title={`Camera Quality: ${currentConfig.label}. Click to choose quality.`}
        aria-label="Camera Quality Selector"
        aria-expanded={isOpen}
      >
        {isChanging ? (
          <CircleNotch size={16} className="animate-spin text-blue-300" />
        ) : (
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              quality === '1080p'
                ? 'bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse'
                : 'bg-amber-400'
            }`}
          />
        )}
        <span className="font-extrabold tracking-wide">{currentConfig.shortLabel}</span>
        <CaretDown
          size={14}
          weight="bold"
          className={`transition-transform duration-200 text-blue-300 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Floating Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl bg-navy-900/98 backdrop-blur-2xl border border-white/15 p-2 shadow-2xl z-50 animate-fadeIn text-white"
        >
          <div className="px-3 py-1.5 border-b border-white/10 mb-1">
            <p className="text-[10px] font-mono uppercase tracking-wider text-blue-300/80 font-bold flex items-center gap-1">
              <Sparkle size={12} weight="fill" className="text-amber-400" />
              <span>Camera Broadcast Quality</span>
            </p>
          </div>

          {(['1080p', '720p'] as CameraQuality[]).map((q) => {
            const config = CAMERA_QUALITY_CONFIGS[q];
            const isSelected = q === quality;
            return (
              <button
                key={q}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(q)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-start justify-between gap-2 text-xs ${
                  isSelected
                    ? 'bg-blue-600/30 text-white border border-blue-400/40'
                    : 'hover:bg-white/10 text-white/80 border border-transparent'
                }`}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        q === '1080p' ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                    />
                    <span>{q === '1080p' ? '1080p Full HD' : '720p HD'}</span>
                    {q === '1080p' && (
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-200 font-mono font-bold">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-blue-200/70 font-sans leading-tight">
                    {q === '1080p'
                      ? '1920×1080 • Best for Board & Text'
                      : '1280×720 • Lower Bandwidth'}
                  </p>
                </div>
                {isSelected && (
                  <Check size={16} weight="bold" className="text-emerald-400 shrink-0 mt-0.5" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
