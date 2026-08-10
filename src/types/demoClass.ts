/**
 * Demo Class Types
 *
 * Stream-scoped demo/marketing videos shown at the very top of the student
 * Home screen (approved architecture Option B — multiple demos per stream,
 * students read the latest published one).
 *
 * Mirrors the `demo_classes` table created in migration 106:
 *   - enum demo_class_status: draft | published | archived
 *   - video lives in the existing `content-videos` storage bucket
 *   - `published_at` is enforced by ck_demo_classes_published_at
 *     (published/archived → NOT NULL, draft → NULL)
 *
 * @module types/demoClass
 */

/** Lifecycle of a demo class (`demo_class_status` enum from migration 106). */
export type DemoClassStatus = 'draft' | 'published' | 'archived';

/** A demo class row (camelCase, consumer-facing). */
export interface DemoClass {
  demoClassId: string;
  instituteId: string;
  streamId: string;
  /** Joined stream name (from the streams table) when fetched with the join. */
  streamName: string | null;
  title: string;
  description: string | null;
  /** Storage bucket — defaults to the existing `content-videos` bucket. */
  storageBucket: string;
  storagePath: string;
  thumbnailBucket: string | null;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  status: DemoClassStatus;
  displayOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** Filters for the admin demo class list. */
export interface DemoClassFilters {
  instituteId?: string;
  streamId?: string;
  status?: DemoClassStatus;
  /** Search by title (ilike). */
  search?: string;
}

/** Input for creating a demo class (file upload + metadata). */
export interface CreateDemoClassParams {
  instituteId: string;
  streamId: string;
  /** Display title. Minimum 3 characters (DB CHECK). */
  title: string;
  description?: string | null;
  /**
   * Video file — REQUIRED for creation.
   *
   * Admin web only — always a browser `File` so the storage extension/MIME
   * validation (content_video config) receives a real file name.
   */
  file: File;
  /** Optional thumbnail image (JPEG/PNG/WebP). */
  thumbnailFile?: File | Blob | ArrayBuffer;
  durationSeconds?: number | null;
  displayOrder?: number;
  /** profiles.profile_id of the acting admin. */
  createdBy: string;
  /** Optional upload progress callback. */
  onProgress?: (loaded: number, total: number) => void;
}

/** Fields that can be updated on an existing demo class. */
export interface UpdateDemoClassParams {
  streamId?: string;
  title?: string;
  description?: string | null;
  /**
   * Optional video replacement. Only allowed while the demo is in
   * `draft` or `archived` status — published demos are never silently
   * swapped (matches the content module's file-replacement guard).
   * Admin web only — always a browser `File`.
   */
  file?: File;
  thumbnailFile?: File | Blob | ArrayBuffer;
  durationSeconds?: number | null;
  displayOrder?: number;
  /** Optional upload progress callback. */
  onProgress?: (loaded: number, total: number) => void;
}
