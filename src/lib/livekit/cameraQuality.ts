import { VideoPresets, type VideoCaptureOptions, type TrackPublishOptions } from 'livekit-client';

export type CameraQuality = '1080p' | '720p';

export interface CameraQualityConfig {
  id: CameraQuality;
  label: string;
  shortLabel: string;
  description: string;
  capture: VideoCaptureOptions;
  publish: TrackPublishOptions;
}

export const CAMERA_QUALITY_CONFIGS: Record<CameraQuality, CameraQualityConfig> = {
  '1080p': {
    id: '1080p',
    label: 'Full HD 1080p (Default - Best for Board & Text)',
    shortLabel: '1080p FHD',
    description: '1920x1080 @ 30fps, 4.0 Mbps max bitrate, prioritized resolution',
    capture: {
      resolution: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        aspectRatio: 16 / 9,
      },
    },
    publish: {
      simulcast: true,
      videoEncoding: {
        maxBitrate: 4_000_000, // 4.0 Mbps for sharp high-frequency board text
        maxFramerate: 30,
      },
      videoSimulcastLayers: [
        VideoPresets.h360,
        VideoPresets.h720,
      ],
      degradationPreference: 'maintain-resolution',
    },
  },
  '720p': {
    id: '720p',
    label: 'HD 720p (Fallback - Low Bandwidth)',
    shortLabel: '720p HD',
    description: '1280x720 @ 30fps, 1.7 Mbps max bitrate, prioritized resolution',
    capture: {
      resolution: {
        width: 1280,
        height: 720,
        frameRate: 30,
        aspectRatio: 16 / 9,
      },
    },
    publish: {
      simulcast: true,
      videoEncoding: {
        maxBitrate: 1_700_000, // 1.7 Mbps
        maxFramerate: 30,
      },
      videoSimulcastLayers: [
        VideoPresets.h180,
        VideoPresets.h360,
      ],
      degradationPreference: 'maintain-resolution',
    },
  },
};
