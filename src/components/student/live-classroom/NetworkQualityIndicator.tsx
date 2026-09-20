'use client';

import React from 'react';
import { ConnectionQuality } from 'livekit-client';
import { WifiHigh, WifiMedium, WifiLow, WifiSlash } from '@phosphor-icons/react';

interface NetworkQualityIndicatorProps {
  quality?: ConnectionQuality;
  isReconnecting?: boolean;
}

export const NetworkQualityIndicator: React.FC<NetworkQualityIndicatorProps> = ({
  quality,
  isReconnecting,
}) => {
  if (isReconnecting) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold backdrop-blur-xs">
        <WifiSlash size={13} weight="bold" />
        <span className="hidden sm:inline">Reconnecting...</span>
      </div>
    );
  }

  let label = 'Good';
  let colorClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  let Icon = WifiHigh;

  if (quality === ConnectionQuality.Excellent) {
    label = 'Excellent';
    colorClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    Icon = WifiHigh;
  } else if (quality === ConnectionQuality.Good) {
    label = 'Good';
    colorClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    Icon = WifiMedium;
  } else if (quality === ConnectionQuality.Poor) {
    label = 'Poor';
    colorClass = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    Icon = WifiLow;
  } else if (quality === ConnectionQuality.Lost) {
    label = 'Lost';
    colorClass = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
    Icon = WifiSlash;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium backdrop-blur-xs ${colorClass}`}
      title={`Network Quality: ${label}`}
    >
      <Icon size={13} weight="bold" />
      <span className="hidden md:inline">{label}</span>
    </div>
  );
};
