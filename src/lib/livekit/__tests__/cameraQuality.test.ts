import { describe, it, expect } from 'vitest';
import { CAMERA_QUALITY_CONFIGS, type CameraQuality } from '@/lib/livekit/cameraQuality';

describe('LiveKit Teacher Camera Quality Configuration', () => {
  it('defines 1080p Full HD as default with correct constraints', () => {
    const config1080p = CAMERA_QUALITY_CONFIGS['1080p'];
    expect(config1080p).toBeDefined();
    expect(config1080p.capture.resolution?.width).toBe(1920);
    expect(config1080p.capture.resolution?.height).toBe(1080);
    expect(config1080p.capture.resolution?.frameRate).toBe(30);
    expect(config1080p.publish.videoEncoding?.maxBitrate).toBe(4_000_000);
    expect(config1080p.publish.degradationPreference).toBe('maintain-resolution');
    expect(config1080p.publish.simulcast).toBe(true);
    expect(config1080p.publish.videoSimulcastLayers).toHaveLength(2);
  });

  it('defines 720p HD as optional fallback with correct constraints', () => {
    const config720p = CAMERA_QUALITY_CONFIGS['720p'];
    expect(config720p).toBeDefined();
    expect(config720p.capture.resolution?.width).toBe(1280);
    expect(config720p.capture.resolution?.height).toBe(720);
    expect(config720p.capture.resolution?.frameRate).toBe(30);
    expect(config720p.publish.videoEncoding?.maxBitrate).toBe(1_700_000);
    expect(config720p.publish.degradationPreference).toBe('maintain-resolution');
    expect(config720p.publish.simulcast).toBe(true);
    expect(config720p.publish.videoSimulcastLayers).toHaveLength(2);
  });

  it('preserves maintain-resolution in both 1080p and 720p modes', () => {
    const qualities: CameraQuality[] = ['1080p', '720p'];
    for (const q of qualities) {
      expect(CAMERA_QUALITY_CONFIGS[q].publish.degradationPreference).toBe('maintain-resolution');
    }
  });
});
