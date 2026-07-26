/**
 * LiveKit Cloud Recording Provider
 *
 * Implements IRecordingProvider for LiveKit Cloud's Egress API.
 * Recordings are captured from LiveKit rooms and exported to
 * Cloudflare R2 via the LiveKit Egress API.
 *
 * This provider delegates the actual LiveKit API calls to a Supabase
 * Edge Function (`recording-egress-*`) which holds the LiveKit API
 * key/secret server-side and is not exposed to the client.
 *
 * ## Provider Switch (Future)
 *
 * To switch to Self-Hosted LiveKit, create a new provider implementing
 * `IRecordingProvider` and register it in the app bootstrap:
 *
 * ```typescript
 * import { selfHostedProvider } from './providers/selfHostedProvider';
 * setRecordingProvider(selfHostedProvider);
 * ```
 *
 * No UI components, hooks, or Redux slices need to change.
 *
 * @module services/recording/providers/liveKitCloudProvider
 */

import { supabase } from '@/config/supabase';
import type { IRecordingProvider, ProviderStartResult, ProviderStatusResult } from '@/types/recording';

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Environment variables required for LiveKit Cloud integration.
 *
 * These are used by the Supabase Edge Functions, NOT by this provider
 * directly. The provider simply forwards requests to the Edge Function
 * which holds the credentials server-side.
 *
 * Client-side env vars (NEXT_PUBLIC_*) are only used for Edge Function
 * invocation, not for direct LiveKit API access.
 */
const R2_BUCKET_NAME = process.env.NEXT_PUBLIC_R2_RECORDINGS_BUCKET ?? 'recorded-classes';

// ═══════════════════════════════════════════════════════════════════════════
//  Provider Implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LiveKit Cloud implementation of IRecordingProvider.
 *
 * Uses Supabase Edge Functions as a secure proxy for LiveKit Egress API
 * calls. The Edge Functions handle:
 * - Authentication (verifies the caller's Supabase JWT)
 * - LiveKit API signing (uses server-side LIVEKIT_API_KEY/SECRET)
 * - R2 export configuration (bucket, path, format)
 *
 * @see https://docs.livekit.io/egress/overview/
 */
export const liveKitCloudProvider: IRecordingProvider = {
  /**
   * Start recording a LiveKit room.
   *
   * Calls the `recording-egress-start` Edge Function which:
   * 1. Authenticates the caller via Supabase JWT
   * 2. Validates the teacher owns the room
   * 3. Calls LiveKit Egress API: POST /egress/start
   * 4. Returns the egress_id
   *
   * The Edge Function configures the egress to export to Cloudflare R2
   * in MP4 format (H.264 video, AAC audio).
   */
  async startRecording(roomName: string): Promise<ProviderStartResult> {
    const { data, error } = await supabase.functions.invoke(
      'recording-egress-start',
      {
        body: {
          roomName,
          outputConfig: {
            bucket: R2_BUCKET_NAME,
            filePrefix: `recordings/${roomName}`,
            fileFormat: 'mp4',
          },
        },
      },
    );

    if (error || !data?.egressId) {
      throw new Error(
        `Failed to start LiveKit recording: ${error?.message ?? 'No egressId returned'}. ` +
        `Room: ${roomName}`,
      );
    }

    return { egressId: data.egressId };
  },

  /**
   * Stop an active recording.
   *
   * Calls the `recording-egress-stop` Edge Function which:
   * 1. Authenticates the caller
   * 2. Calls LiveKit Egress API: POST /egress/stop
   */
  async stopRecording(egressId: string): Promise<void> {
    const { error } = await supabase.functions.invoke(
      'recording-egress-stop',
      { body: { egressId } },
    );

    if (error) {
      throw new Error(
        `Failed to stop LiveKit recording: ${error.message}. Egress ID: ${egressId}`,
      );
    }
  },

  /**
   * Get the current status of a recording from LiveKit.
   *
   * Calls the `recording-egress-status` Edge Function which:
   * 1. Authenticates the caller
   * 2. Calls LiveKit Egress API: GET /egress/{egressId}
   * 3. Returns the current status and metadata
   */
  async getRecordingStatus(egressId: string): Promise<ProviderStatusResult> {
    const { data, error } = await supabase.functions.invoke(
      'recording-egress-status',
      { body: { egressId } },
    );

    if (error || !data) {
      throw new Error(
        `Failed to get LiveKit recording status: ${error?.message ?? 'No data returned'}. ` +
        `Egress ID: ${egressId}`,
      );
    }

    return {
      status: data.status as 'active' | 'completed' | 'failed',
      durationSeconds: data.durationSeconds as number | undefined,
      fileSizeBytes: data.fileSizeBytes as number | undefined,
    };
  },

  /**
   * Generate a signed playback URL from Cloudflare R2.
   *
   * Calls the `recording-playback-url` Edge Function which:
   * 1. Authenticates the caller
   * 2. Generates a pre-signed URL for the R2 object
   * 3. Returns the URL (valid for 5 minutes)
   */
  async getPlaybackUrl(storagePath: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke(
      'recording-playback-url',
      {
        body: {
          storagePath,
          bucket: R2_BUCKET_NAME,
          expirySeconds: 300, // 5 minutes
        },
      },
    );

    if (error || !data?.url) {
      throw new Error(
        `Failed to generate playback URL: ${error?.message ?? 'No URL returned'}. ` +
        `Path: ${storagePath}`,
      );
    }

    return data.url;
  },
};
