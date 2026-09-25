# Recorded Classes Module — Implementation Guide

> **Version:** 1.0  
> **Stack:** Next.js (Web Dashboard) + TypeScript + Redux Toolkit + React Query + Supabase + LiveKit Cloud + Cloudflare R2  
> **Last Updated:** 26 July 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Recording Lifecycle](#2-recording-lifecycle)
3. [Database Schema](#3-database-schema)
4. [TypeScript Models](#4-typescript-models)
5. [RecordingService Abstraction](#5-recordingservice-abstraction)
6. [API Contracts](#6-api-contracts)
7. [React Query Hooks](#7-react-query-hooks)
8. [Redux Slice](#8-redux-slice)
9. [Reusable Components](#9-reusable-components)
10. [Teacher Screens](#10-teacher-screens)
11. [Student Screens](#11-student-screens)
12. [Navigation Updates](#12-navigation-updates)
13. [Permissions & RLS](#13-permissions--rls)
14. [Error Handling](#14-error-handling)
15. [Future Scalability (Self-Hosted LiveKit)](#15-future-scalability)
16. [Deployment Checklist](#16-deployment-checklist)
17. [Testing Checklist](#17-testing-checklist)

---

## 1. Architecture Overview

### System Context Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Teacher Web Dashboard                        │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ LiveKit  │  │ Recording  │  │  React   │  │  Teacher Screens  │  │
│  │ Room     │──▶│ Service   │──▶│  Query   │──▶│  (Recordings,    │  │
│  │ (Go Live)│  │ (abstrac- │  │  Hooks   │  │  Details, Share)  │  │
│  └──────────┘  │  tion)     │  └──────────┘  └──────────────────┘  │
│                └─────┬──────┘                                       │
│                      │                                              │
│                ┌─────▼──────┐                                       │
│                │  Redux     │                                       │
│                │  Store     │                                       │
│                └────────────┘                                       │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                      │
         ▼                    ▼                      ▼
┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐
│  LiveKit     │   │  Cloudflare R2   │   │  Supabase          │
│  Cloud       │   │  (Recording      │   │  (Metadata, RLS,   │
│  (Ingest &   │   │   Storage)       │   │   Auth, Webhooks)  │
│  Recording)  │   │  (Egress target) │   │                    │
└──────────────┘   └──────────────────┘   └────────────────────┘
```

### Data Flow (Teacher Starts Recording)

```
Teacher clicks "Start Recording"
        │
        ▼
RecordingService.startRecording(classId)
        │
        ├── 1. Validate teacher owns the live class
        ├── 2. Create `recordings` row (status: 'recording')
        ├── 3. Call LiveKit Egress API to start recording
        │       (WebM/MP4 → exported to Cloudflare R2)
        └── 4. Return { recordingId, status }

[Later: LiveKit webhook fires on recording completion]
        │
        ▼
RecordingService.handleRecordingWebhook(event)
        │
        ├── 1. Update recordings row:
        │       status → 'completed'
        │       storage_path → R2 URL
        │       duration_seconds → actual duration
        │       file_size_bytes → actual file size
        ├── 2. Create notification for batch students
        └── 3. Return success
```

### Data Flow (Student Playback)

```
Student navigates to "Recorded Classes"
        │
        ▼
useRecordings(batchId) → React Query fetches listing
        │
        ▼
Student clicks a recording
        │
        ▼
RecordingService.getPlaybackUrl(recordingId)
        │
        ├── 1. Verify student has access (batch membership)
        ├── 2. Generate signed URL from Cloudflare R2
        └── 3. Return playback_url (streaming-only, download disabled)

Student watches via <VideoPlayer> component
```

---

## 2. Recording Lifecycle

### State Machine

```
                        ┌──────────┐
                        │  RECORD- │
                        │  ING     │◄────────── Teacher starts recording
                        └────┬─────┘
                             │
                     ┌───────▼────────┐
                     │  PROCESSING    │◄────── LiveKit exports to R2
                     └───────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
        │ COMPLETED │ │  FAILED   │ │  PARTIAL  │
        │ (success) │ │ (error)   │ │ (30s+     │
        └─────┬─────┘ └─────┬─────┘ │  clip)    │
              │             │       └─────┬─────┘
              │             │             │
              ▼             ▼             ▼
        Available for   Teacher can     Teacher can
        student         retry (/retry)  keep or retry
        streaming
```

### Status Enum

| Status | Description | Teacher Action | Student Action |
|--------|------------|----------------|----------------|
| `recording` | LiveKit Egress active | Waiting | N/A |
| `processing` | Exporting to R2 | Waiting | N/A |
| `completed` | Ready for playback | View, Share, Delete | Stream |
| `failed` | Processing error | Retry, Delete | N/A |
| `partial` | Short clip (<30s), possibly audio-only | Keep or Retry | Stream (if kept) |

### Retention Policy

- Recordings are kept **indefinitely** (cloud storage is cheap)
- Teacher can **soft-delete** any recording
- Admin can **hard-delete** after 90 days of soft-delete
- Storage usage is tracked per institute for billing

---

## 3. Database Schema

### Analysis of Existing Schema

After inspecting all 65 migration files, the following observations apply:

1. **No `recordings` table exists** in any migration file. Despite the spec mentioning one, we need to create it.
2. **Live classes table** (`live_classes`) has a `recording_url` column — this stores the legacy recording URL for live classes.
3. **Cloudflare R2** is not yet integrated — recordings will be stored there.
4. **Existing Storage buckets** (`content-pdfs`, `content-videos`, `content-thumbnails`, etc.) in `src/config/storage.ts` are for teacher-uploaded content, not for recordings.

### New Table: `recordings`

```sql
-- Migration: 065_create_recordings_table.sql

create table public.recordings (
    -- Primary key
    recording_id      uuid primary key default gen_random_uuid(),

    -- Ownership & Scoping
    institute_id      uuid not null references public.institutes(institute_id),
    teacher_id        uuid not null references public.teacher_details(teacher_id),

    -- Source class (nullable for standalone recordings)
    class_id          uuid references public.live_classes(class_id) on delete set null,

    -- Recording metadata
    title             text not null check (char_length(title) >= 3),
    description       text,
    recording_type    text not null default 'live_class'
                      check (recording_type in ('live_class', 'practice', 'demo')),

    -- Status tracking
    status            text not null default 'processing'
                      check (status in ('recording', 'processing', 'completed',
                                         'failed', 'partial')),

    -- Duration & size
    duration_seconds  integer check (duration_seconds > 0),
    file_size_bytes   bigint check (file_size_bytes > 0),

    -- Storage paths (Cloudflare R2)
    storage_bucket    text,
    storage_path      text,    -- object key within bucket
    playback_url      text,    -- generated signed URL (regenerated on demand)

    -- Thumbnail
    thumbnail_url     text,

    -- Processing metadata
    error_message     text,
    retry_count       integer not null default 0,
    last_retried_at   timestamptz,

    -- Batch membership (denormalized for RLS — recordings visible to batch students)
    batch_id          uuid references public.batches(batch_id) on delete set null,

    -- Soft delete
    is_deleted        boolean not null default false,
    deleted_at        timestamptz,

    -- Audit timestamps
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- Indexes
create index idx_recordings_institute on public.recordings(institute_id, status);
create index idx_recordings_teacher on public.recordings(teacher_id, status);
create index idx_recordings_batch on public.recordings(batch_id, status);
create index idx_recordings_class on public.recordings(class_id);
create index idx_recordings_active on public.recordings(institute_id)
    where is_deleted = false and status = 'completed';
create index idx_recordings_pending on public.recordings(status)
    where status in ('recording', 'processing');

-- Updated_at trigger (same pattern as other tables)
create trigger trg_recordings_updated_at
    before update on public.recordings
    for each row
    execute function public.trigger_set_updated_at();
```

### RLS Policies

```sql
-- Teachers: full CRUD on their own recordings
create policy "Teachers manage their recordings"
    on public.recordings
    for all
    to authenticated
    using (
        teacher_id in (
            select teacher_id from public.teacher_details
            where profile_id = auth.uid()
        )
        and is_deleted = false
    )
    with check (
        teacher_id in (
            select teacher_id from public.teacher_details
            where profile_id = auth.uid()
        )
    );

-- Students: read-only access to completed recordings in their batches
create policy "Students view batch recordings"
    on public.recordings
    for select
    to authenticated
    using (
        status = 'completed'
        and is_deleted = false
        and batch_id in (
            select batch_id from public.batch_students
            where student_id in (
                select student_id from public.student_details
                where profile_id = auth.uid()
            )
        )
    );
```

### Storage Configuration (to add to `src/config/storage.ts`)

```typescript
/** Bucket for recorded class videos stored in Cloudflare R2 (via LiveKit Egress). */
export const RECORDED_CLASSES_BUCKET = 'recorded-classes' as const;
```

No Supabase Storage bucket is needed for recordings — Cloudflare R2 handles storage directly. The `storage_bucket` and `storage_path` columns in `recordings` store the R2 object identifiers.

---

## 4. TypeScript Models

### File: `src/types/recording.ts`

```typescript
// ─── Enums ──────────────────────────────────────────────────────────────────

export type RecordingStatus =
  | 'recording'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial';

export type RecordingType = 'live_class' | 'practice' | 'demo';

// ─── Core Model ─────────────────────────────────────────────────────────────

export interface Recording {
  recordingId: string;
  instituteId: string;
  teacherId: string;
  classId: string | null;
  title: string;
  description: string | null;
  recordingType: RecordingType;
  status: RecordingStatus;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  storageBucket: string | null;
  storagePath: string | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  lastRetriedAt: string | null;
  batchId: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Extended Models ────────────────────────────────────────────────────────

export interface RecordingWithTeacher extends Recording {
  teacherName: string;
}

export interface RecordingWithClass extends Recording {
  className: string;
  batchName: string;
}

// ─── Request / Response ─────────────────────────────────────────────────────

export interface StartRecordingRequest {
  classId: string;
  title: string;
  description?: string | null;
  recordingType?: RecordingType;
}

export interface StartRecordingResponse {
  recordingId: string;
  status: RecordingStatus;
}

export interface RecordingListFilters {
  status?: RecordingStatus;
  batchId?: string;
  teacherId?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

export interface RecordingSortOptions {
  sortBy?: 'createdAt' | 'title' | 'durationSeconds' | 'status';
  sortDirection?: 'asc' | 'desc';
}

export interface RecordingWebhookPayload {
  recordingId: string;
  livekitEgressId: string;
  status: 'completed' | 'failed';
  durationSeconds: number;
  fileSizeBytes: number;
  storagePath: string;
  playbackUrl: string;
  errorMessage?: string;
}
```

---

## 5. RecordingService Abstraction

### Architecture

```
RecordingService (Interface/Abstract)
    │
    ├── LiveKitRecordingProvider (LiveKit Cloud)
    │       - Uses LiveKit Egress API
    │       - Exports to Cloudflare R2
    │       - Handles webhook verification
    │
    └── SelfHostedRecordingProvider (Future)
            - Uses LiveKit Self-Hosted Egress API
            - Same interface, different implementation
```

### File: `src/services/recording/recordingService.ts`

```typescript
/**
 * Recording Service — Abstract Provider Interface
 *
 * This service defines the contract for recording operations. The concrete
 * implementation (LiveKitCloudProvider) can be swapped with a self-hosted
 * LiveKit provider without changing any UI component.
 *
 * @module services/recording/recordingService
 */

import type { ApiResponse } from '@/types/academic';
import type {
  Recording,
  StartRecordingRequest,
  StartRecordingResponse,
  RecordingListFilters,
  RecordingSortOptions,
} from '@/types/recording';

// ─── Provider Interface ─────────────────────────────────────────────────────

export interface IRecordingProvider {
  /** Start recording a LiveKit room. */
  startRecording(classId: string, roomName: string): Promise<{
    egressId: string;
  }>;

  /** Stop an active recording. */
  stopRecording(egressId: string): Promise<void>;

  /** Get recording status from the provider. */
  getRecordingStatus(egressId: string): Promise<{
    status: 'active' | 'completed' | 'failed';
    durationSeconds?: number;
    fileSizeBytes?: number;
  }>;

  /** Get the playback URL (signed). */
  getPlaybackUrl(storagePath: string): Promise<string>;
}

// ─── Service Class ──────────────────────────────────────────────────────────

export const recordingService = {
  /**
   * Start recording a live class.
   * 1. Creates a `recordings` DB row with status='recording'
   * 2. Calls the provider to start LiveKit Egress
   * 3. Updates the DB row with the egress ID
   */
  async startRecording(
    input: StartRecordingRequest,
  ): Promise<ApiResponse<StartRecordingResponse>> {
    // Validate
    if (!input.classId) {
      return { success: false, error: 'classId is required.' };
    }
    if (!input.title?.trim()) {
      return { success: false, error: 'Title is required.' };
    }

    // 1. Load the live class to get room_name and teacher_id
    // 2. Create recordings row
    // 3. Call provider.startRecording(roomName)
    // 4. Update row with egress_id
    // 5. Return result

    // Implementation details in LiveKitCloudProvider
    throw new Error('Not implemented — inject IRecordingProvider');
  },

  /**
   * Stop an active recording.
   */
  async stopRecording(
    recordingId: string,
  ): Promise<ApiResponse<void>> {
    // Validate
    // 1. Fetch recording row (verify teacher owns it)
    // 2. Call provider.stopRecording(egressId)
    // 3. Update status → 'processing'
    throw new Error('Not implemented');
  },

  /**
   * Get a single recording by ID.
   */
  async getRecording(
    recordingId: string,
  ): Promise<ApiResponse<Recording>> {
    // Validate UUID
    // Fetch from DB
    // Map to camelCase
    throw new Error('Not implemented');
  },

  /**
   * List recordings with filters, sort, pagination.
   */
  async getRecordings(
    filters?: RecordingListFilters,
    sort?: RecordingSortOptions,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<ApiResponse<{ recordings: Recording[]; total: number }>> {
    throw new Error('Not implemented');
  },

  /**
   * Get the current recording status (from provider).
   */
  async getRecordingStatus(
    recordingId: string,
  ): Promise<ApiResponse<{ status: string; durationSeconds?: number }>> {
    // 1. Fetch recording row
    // 2. If status is 'recording' or 'processing', poll provider
    // 3. Update DB if status changed
    throw new Error('Not implemented');
  },

  /**
   * Delete a recording (soft delete).
   */
  async deleteRecording(
    recordingId: string,
  ): Promise<ApiResponse<void>> {
    throw new Error('Not implemented');
  },

  /**
   * Get a playback URL for a recording.
   * Generates a signed URL from Cloudflare R2.
   */
  async getPlaybackUrl(
    recordingId: string,
  ): Promise<ApiResponse<{ playbackUrl: string }>> {
    throw new Error('Not implemented');
  },

  /**
   * Retry a failed recording.
   */
  async retryRecording(
    recordingId: string,
  ): Promise<ApiResponse<StartRecordingResponse>> {
    throw new Error('Not implemented');
  },

  /**
   * Handle LiveKit Egress webhook callback.
   * Called by a Supabase Edge Function when LiveKit sends the
   * egress.completed / egress.failed webhook event.
   */
  async handleWebhook(
    payload: {
      egressId: string;
      status: 'completed' | 'failed';
      durationSeconds?: number;
      fileSizeBytes?: number;
      storagePath?: string;
      playbackUrl?: string;
      errorMessage?: string;
    },
  ): Promise<ApiResponse<void>> {
    throw new Error('Not implemented');
  },
};

// ─── Provider Resolution ───────────────────────────────────────────────────

/**
 * Current recording provider.
 * Change this to switch between LiveKit Cloud and Self-Hosted LiveKit.
 *
 * @example
 * import { selfHostedProvider } from './providers/selfHostedProvider';
 * setRecordingProvider(selfHostedProvider);
 */
let _provider: IRecordingProvider | null = null;

export function setRecordingProvider(provider: IRecordingProvider): void {
  _provider = provider;
}

export function getRecordingProvider(): IRecordingProvider {
  if (!_provider) {
    throw new Error(
      'Recording provider not set. Call setRecordingProvider() during app bootstrap.',
    );
  }
  return _provider;
}
```

### File: `src/services/recording/providers/liveKitCloudProvider.ts`

```typescript
/**
 * LiveKit Cloud Recording Provider
 *
 * Implements IRecordingProvider for LiveKit Cloud's Egress API.
 * Recordings are exported to Cloudflare R2.
 *
 * @module services/recording/providers/liveKitCloudProvider
 */

import type { IRecordingProvider } from '../recordingService';
import { supabase } from '@/config/supabase';

// ─── Configuration ──────────────────────────────────────────────────────────

const LIVEKIT_API_KEY = process.env.NEXT_PUBLIC_LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.NEXT_PUBLIC_LIVEKIT_API_SECRET ?? '';
const LIVEKIT_WS_URL = process.env.NEXT_PUBLIC_LIVEKIT_WS_URL ?? '';
const R2_BUCKET_NAME = process.env.NEXT_PUBLIC_R2_RECORDINGS_BUCKET ?? 'recorded-classes';
const R2_ENDPOINT = process.env.NEXT_PUBLIC_R2_ENDPOINT ?? '';
const R2_ACCESS_KEY = process.env.NEXT_PUBLIC_R2_ACCESS_KEY ?? '';
const R2_SECRET_KEY = process.env.NEXT_PUBLIC_R2_SECRET_KEY ?? '';

/**
 * LiveKit Cloud implementation of IRecordingProvider.
 *
 * Uses LiveKit's Egress API to start/stop room recordings and
 * exports completed files to Cloudflare R2.
 */
export const liveKitCloudProvider: IRecordingProvider = {
  async startRecording(classId: string, roomName: string) {
    // This should call a Supabase Edge Function that:
    // 1. Authenticates the teacher
    // 2. Calls LiveKit Egress API (POST /egress/start)
    //    with R2 output config
    // 3. Returns the egress_id

    const { data, error } = await supabase.functions.invoke(
      'recording-egress-start',
      {
        body: { classId, roomName, storageConfig: { bucket: R2_BUCKET_NAME } },
      },
    );

    if (error || !data?.egressId) {
      throw new Error(
        `Failed to start recording: ${error?.message ?? 'No egressId returned'}`,
      );
    }

    return { egressId: data.egressId };
  },

  async stopRecording(egressId: string) {
    const { error } = await supabase.functions.invoke(
      'recording-egress-stop',
      { body: { egressId } },
    );

    if (error) {
      throw new Error(`Failed to stop recording: ${error.message}`);
    }
  },

  async getRecordingStatus(egressId: string) {
    const { data, error } = await supabase.functions.invoke(
      'recording-egress-status',
      { body: { egressId } },
    );

    if (error || !data) {
      throw new Error(
        `Failed to get recording status: ${error?.message ?? 'No data'}`,
      );
    }

    return {
      status: data.status as 'active' | 'completed' | 'failed',
      durationSeconds: data.durationSeconds,
      fileSizeBytes: data.fileSizeBytes,
    };
  },

  async getPlaybackUrl(storagePath: string) {
    // Generate a signed URL for Cloudflare R2
    // This calls the Edge Function that creates a pre-signed URL
    const { data, error } = await supabase.functions.invoke(
      'recording-playback-url',
      { body: { storagePath, bucket: R2_BUCKET_NAME } },
    );

    if (error || !data?.url) {
      throw new Error(
        `Failed to generate playback URL: ${error?.message ?? 'No URL returned'}`,
      );
    }

    return data.url;
  },
};
```

---

## 6. API Contracts

### Service Methods — Request/Response Summary

| Method | Request | Response (Success) | Error |
|--------|---------|-------------------|-------|
| `startRecording` | `{ classId, title, description?, recordingType? }` | `{ recordingId, status }` | `Validation: classId, title required` |
| `stopRecording` | `{ recordingId }` | `void` | `NotFound, NotOwnedByTeacher` |
| `getRecording` | `{ recordingId }` | `Recording` | `NotFound` |
| `getRecordings` | `{ filters?, sort?, pagination? }` | `{ recordings[], total }` | — |
| `getRecordingStatus` | `{ recordingId }` | `{ status, durationSeconds? }` | `NotFound` |
| `deleteRecording` | `{ recordingId }` | `void` | `NotFound, NotOwnedByTeacher` |
| `getPlaybackUrl` | `{ recordingId }` | `{ playbackUrl }` | `NotFound, NotCompleted` |
| `retryRecording` | `{ recordingId }` | `{ recordingId, status }` | `NotFound, NotFailed` |
| `handleWebhook` | `{ egressId, status, ... }` | `void` | `InvalidSignature` |

### Error Response Shape

```typescript
{
  success: false,
  error: string,
  code?: 'NOT_FOUND' | 'VALIDATION' | 'PERMISSION' | 'PROVIDER_ERROR' | 'TIMEOUT'
}
```

---

## 7. React Query Hooks

### File: `src/hooks/recording/queryKeys.ts`

```typescript
export const recordingKeys = {
  all: ['recordings'] as const,
  lists: () => [...recordingKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...recordingKeys.lists(), filters] as const,
  details: () => [...recordingKeys.all, 'detail'] as const,
  detail: (id: string) => [...recordingKeys.details(), id] as const,
  status: (id: string) => [...recordingKeys.all, 'status', id] as const,
  playback: (id: string) => [...recordingKeys.all, 'playback', id] as const,
};
```

### File: `src/hooks/recording/useRecordings.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recordingService } from '@/services/recording/recordingService';
import { recordingKeys } from './queryKeys';
import type { RecordingListFilters, RecordingSortOptions } from '@/types/recording';
import type { PaginationParams } from '@/types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

export function useRecordings(
  filters?: RecordingListFilters,
  sort?: RecordingSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: recordingKeys.list({ filters, sort, pagination }),
    queryFn: () => recordingService.getRecordings(filters, sort, pagination),
  });
}

export function useRecording(recordingId: string | undefined | null) {
  return useQuery({
    queryKey: recordingKeys.detail(recordingId ?? ''),
    queryFn: () => recordingService.getRecording(recordingId!),
    enabled: !!recordingId,
  });
}

export function useRecordingStatus(recordingId: string | undefined | null) {
  return useQuery({
    queryKey: recordingKeys.status(recordingId ?? ''),
    queryFn: () => recordingService.getRecordingStatus(recordingId!),
    enabled: !!recordingId,
    refetchInterval: (query) => {
      const data = query.state.data?.data;
      // Poll every 5s while recording is active
      if (data && (data.status === 'recording' || data.status === 'processing')) {
        return 5000;
      }
      return false;
    },
  });
}

export function usePlaybackUrl(recordingId: string | undefined | null) {
  return useQuery({
    queryKey: recordingKeys.playback(recordingId ?? ''),
    queryFn: () => recordingService.getPlaybackUrl(recordingId!),
    enabled: !!recordingId,
    staleTime: 1000 * 60 * 5, // 5 minutes — signed URLs are short-lived
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useStartRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof recordingService.startRecording>[0]) =>
      recordingService.startRecording(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.lists() });
    },
  });
}

export function useStopRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recordingId: string) =>
      recordingService.stopRecording(recordingId),
    onSuccess: (_data, recordingId) => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.detail(recordingId) });
      queryClient.invalidateQueries({ queryKey: recordingKeys.status(recordingId) });
    },
  });
}

export function useDeleteRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recordingId: string) =>
      recordingService.deleteRecording(recordingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.lists() });
    },
  });
}

export function useRetryRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recordingId: string) =>
      recordingService.retryRecording(recordingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.lists() });
    },
  });
}
```

---

## 8. Redux Slice

### File: `src/store/recordingSlice.ts`

```typescript
/**
 * Recording Slice
 *
 * Manages recording-related client state that is NOT cached by React Query:
 * - Currently active recording (per teacher session)
 * - Recording playback state (playing, paused, buffering)
 * - Transient UI errors
 *
 * React Query handles the server state (lists, details, status polls).
 * This slice only tracks ephemeral client-side concerns.
 *
 * @module store/recordingSlice
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActiveRecording {
  recordingId: string;
  classId: string;
  status: 'recording' | 'processing';
  startedAt: string;
}

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error';

export interface RecordingUIState {
  /** The recording currently being captured (per teacher session). */
  activeRecording: ActiveRecording | null;
  /** Current playback state for the video player. */
  playbackState: PlaybackState;
  /** Transient UI error (cleared after 4s). */
  error: string | null;
  /** Whether the share recording dialog is open. */
  shareDialogOpen: boolean;
  /** The recording ID being shared. */
  shareRecordingId: string | null;
}

const initialState: RecordingUIState = {
  activeRecording: null,
  playbackState: 'idle',
  error: null,
  shareDialogOpen: false,
  shareRecordingId: null,
};

// ─── Slice ──────────────────────────────────────────────────────────────────

const recordingSlice = createSlice({
  name: 'recording',
  initialState,
  reducers: {
    setActiveRecording(state, action: PayloadAction<ActiveRecording | null>) {
      state.activeRecording = action.payload;
    },
    clearActiveRecording(state) {
      state.activeRecording = null;
    },
    setPlaybackState(state, action: PayloadAction<PlaybackState>) {
      state.playbackState = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
    openShareDialog(state, action: PayloadAction<string>) {
      state.shareDialogOpen = true;
      state.shareRecordingId = action.payload;
    },
    closeShareDialog(state) {
      state.shareDialogOpen = false;
      state.shareRecordingId = null;
    },
  },
});

// ─── Actions ────────────────────────────────────────────────────────────────

export const {
  setActiveRecording,
  clearActiveRecording,
  setPlaybackState,
  setError,
  clearError,
  openShareDialog,
  closeShareDialog,
} = recordingSlice.actions;

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectActiveRecording = (state: { recording: RecordingUIState }) =>
  state.recording.activeRecording;

export const selectPlaybackState = (state: { recording: RecordingUIState }) =>
  state.recording.playbackState;

export const selectRecordingError = (state: { recording: RecordingUIState }) =>
  state.recording.error;

export const selectShareDialog = (state: { recording: RecordingUIState }) => ({
  open: state.recording.shareDialogOpen,
  recordingId: state.recording.shareRecordingId,
});

// ─── Reducer ────────────────────────────────────────────────────────────────

export default recordingSlice.reducer;
```

### Store Update (`src/store/index.ts`)

```typescript
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import recordingReducer from './recordingSlice'; // ← ADD

export const makeStore = () => {
  return configureStore({
    reducer: {
      auth: authReducer,
      recording: recordingReducer, // ← ADD
    },
    devTools: process.env.NODE_ENV !== 'production',
  });
};
```

---

## 9. Reusable Components

### File: `src/components/recording/RecordingCard.tsx`

```typescript
'use client';

import type { Recording } from '@/types/recording';
import { RecordingStatusBadge } from './RecordingStatusBadge';
import { RecordingDuration } from './RecordingDuration';
import { formatDate } from '@/lib/utils';

interface RecordingCardProps {
  recording: Recording;
  onPlay?: (recordingId: string) => void;
  onShare?: (recordingId: string) => void;
  onDelete?: (recordingId: string) => void;
  onRetry?: (recordingId: string) => void;
  variant?: 'teacher' | 'student';
}

export function RecordingCard({
  recording,
  onPlay,
  onShare,
  onDelete,
  onRetry,
  variant = 'teacher',
}: RecordingCardProps) {
  return (
    <div className="group rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      {/* Thumbnail */}
      <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
        {recording.thumbnailUrl ? (
          <img
            src={recording.thumbnailUrl}
            alt={recording.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <svg className="h-12 w-12 text-gray-400" ... />
          </div>
        )}
        {recording.durationSeconds && (
          <RecordingDuration seconds={recording.durationSeconds} />
        )}
      </div>

      {/* Content */}
      <div className="space-y-2">
        <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          {recording.title}
        </h3>

        <RecordingStatusBadge status={recording.status} />

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(recording.createdAt)}
        </p>
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        {recording.status === 'completed' && (
          <button
            onClick={() => onPlay?.(recording.recordingId)}
            className="..."
          >
            Play
          </button>
        )}
        {variant === 'teacher' && recording.status === 'completed' && (
          <button onClick={() => onShare?.(recording.recordingId)}>Share</button>
        )}
        {variant === 'teacher' && (
          <button onClick={() => onDelete?.(recording.recordingId)}>Delete</button>
        )}
        {variant === 'teacher' && recording.status === 'failed' && (
          <button onClick={() => onRetry?.(recording.recordingId)}>Retry</button>
        )}
      </div>
    </div>
  );
}
```

### File: `src/components/recording/RecordingStatusBadge.tsx`

```typescript
import type { RecordingStatus } from '@/types/recording';

const STATUS_CONFIG: Record<RecordingStatus, {
  label: string;
  className: string;
  dotClassName: string;
}> = {
  recording: {
    label: 'Recording',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    dotClassName: 'bg-yellow-500 animate-pulse',
  },
  processing: {
    label: 'Processing',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    dotClassName: 'bg-blue-500 animate-pulse',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    dotClassName: 'bg-emerald-500',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    dotClassName: 'bg-red-500',
  },
  partial: {
    label: 'Partial',
    className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    dotClassName: 'bg-orange-500',
  },
};
```

### File: `src/components/recording/RecordingDuration.tsx`

```typescript
interface RecordingDurationProps {
  seconds: number;
}

export function RecordingDuration({ seconds }: RecordingDurationProps) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return (
    <span className="inline-flex items-center rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
      {parts.join(' ')}
    </span>
  );
}
```

### File: `src/components/recording/ProcessingIndicator.tsx`

```typescript
export function ProcessingIndicator() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
      <svg className="h-5 w-5 animate-spin text-blue-500" ... />
      <div>
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
          Processing Recording
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400">
          Your recording is being processed and may take a few minutes.
        </p>
      </div>
    </div>
  );
}
```

### File: `src/components/recording/EmptyState.tsx`

```typescript
interface RecordingsEmptyStateProps {
  variant: 'teacher' | 'student';
}

export function RecordingsEmptyState({ variant }: RecordingsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg className="mb-4 h-16 w-16 text-gray-300 dark:text-gray-600" ... />
      <h3 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {variant === 'teacher' ? 'No recordings yet' : 'No recordings available'}
      </h3>
      <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
        {variant === 'teacher'
          ? 'Recordings will appear here after you finish a live class with recording enabled.'
          : 'Your teachers have not published any recorded classes yet.'}
      </p>
    </div>
  );
}
```

### File: `src/components/recording/LoadingSkeleton.tsx`

```typescript
export function RecordingsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <div className="mb-3 aspect-video w-full rounded-md bg-gray-200 dark:bg-gray-700" />
          <div className="mb-2 h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mb-3 h-3 w-1/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      ))}
    </div>
  );
}
```

---

## 10. Teacher Screens

### 10.1 Recorded Classes List

**File:** `src/app/teacher/recordings/page.tsx`

Features:
- Grid view of all recordings (completed → failed → processing)
- Filter by status (tabs: All, Completed, Processing, Failed)
- Search by title
- Sort by date, duration, title
- Actions: Play, Share, Delete, Retry
- Count badge showing "Recording..." with live status indicator
- Empty state when no recordings exist

### 10.2 Recording Details

**File:** `src/app/teacher/recordings/[id]/page.tsx`

Features:
- Full recording metadata display
- Video player (if completed)
- Status indicator with polling (auto-refreshes every 5s for processing)
- Duration, file size, creation date
- Error message display (if failed)
- Actions: Share, Delete, Retry
- Breadcrumb navigation

### 10.3 Share Recording Dialog

**File:** `src/components/recording/ShareRecordingDialog.tsx`

Features:
- Select batches to share with
- Copy shareable link
- Embed code (for LMS)
- Close button

### 10.4 Delete Confirmation

- Standard confirmation dialog (reuse `ConfirmAction` pattern from admin dashboard)
- Soft delete (recording hidden from students, visible to teacher with "deleted" marker)

---

## 11. Student Screens

### 11.1 Recorded Classes List

**File:** `src/app/student/recordings/page.tsx`

Features:
- Grid/list view of completed recordings in student's batches
- Search by title
- Filter by batch, subject
- Sort by date, duration
- Empty state when no recordings available
- Each card shows: thumbnail, title, duration, batch name, teacher name, date

### 11.2 Video Player

**File:** `src/components/recording/RecordingPlayer.tsx`

Features:
- Play/pause
- Seek bar
- Volume control
- Fullscreen toggle
- Picture-in-picture
- Download DISABLED (streaming only)
- Buffering indicator
- Error state with retry

---

## 12. Navigation Updates

### Teacher Sidebar

```typescript
// Add to teacher navigation config
{
  label: 'Recorded Classes',
  path: '/teacher/recordings',
  icon: VideoCamera,
}
```

### Student Sidebar

```typescript
// Add to student navigation config
{
  label: 'Recorded Classes',
  path: '/student/recordings',
  icon: PlayCircle,
}
```

### Route Structure

```
/teacher/recordings                    - List (teacher)
/teacher/recordings/[id]               - Details (teacher)
/student/recordings                    - List (student)
/student/recordings/[id]               - Player (student)
/api/recording/webhook                 - LiveKit Egress webhook (Edge Function)
```

---

## 13. Permissions & RLS

### Role-Based Access

| Action | Teacher | Student | Admin | Notes |
|--------|---------|---------|-------|-------|
| Start Recording | ✅ | ❌ | ❌ | Must own the live class |
| Stop Recording | ✅ | ❌ | ❌ | Must own the recording |
| View Own Recordings | ✅ | ❌ | ❌ | Teacher sees all their recordings including deleted |
| View Batch Recordings | ✅ | ✅ | ❌ | If assigned to the batch |
| Stream Playback | ✅ | ✅ | ❌ | Download always disabled |
| Delete (soft) | ✅ | ❌ | ✅ | Teacher deletes own, admin deletes any |
| Retry Failed | ✅ | ❌ | ✅ | Teacher retries own, admin retries any |
| Share/Assign to Batch | ✅ | ❌ | ❌ | Teacher shares own recordings |
| Hard Delete | ❌ | ❌ | ✅ | Admin only, after 90d soft-delete |

### RLS Summary

```sql
-- Teachers:
--   INSERT: profile_id → teacher_details matches teacher_id
--   SELECT/UPDATE/DELETE: own recordings (teacher_id matches)
-- Students:
--   SELECT only: status='completed' AND batch_id in their batches
```

---

## 14. Error Handling

### Scenarios & Responses

| Scenario | User-Facing Message | Technical Action |
|----------|--------------------|------------------|
| Recording failed to start | "Unable to start recording. Please ensure the class is live." | Log full error, return `{ success: false, error }` |
| Processing timeout (>30 min) | "Recording is taking longer than expected. It will appear here once ready." | Auto-retry webhook poll, notify teacher if pending after 60 min |
| Upload to R2 failed | "We encountered an issue saving your recording. Please try again." | Update status → `failed`, log R2 error, enable retry |
| Playback URL expired | "Playback link expired. Please refresh and try again." | Auto-regenerate signed URL on retry |
| Network disconnected (student) | "Connection lost. Check your internet and try again." | Show retry button on video player |
| Student not in batch | "You don't have access to this recording." | 403 response, redirect to recordings list |
| Recording still processing | "This recording is still being processed. Please wait..." | Show ProcessingIndicator, auto-refresh |

### Error Component

```typescript
// src/components/recording/RecordingError.tsx
export function RecordingError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
      <div className="flex items-start gap-3">
        <ExclamationCircle size={20} className="mt-0.5 shrink-0 text-red-500" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            {error}
          </p>
        </div>
        {onRetry && (
          <button onClick={onRetry} className="...">
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
```

---

## 15. Future Scalability

### Self-Hosted LiveKit Migration

The `IRecordingProvider` interface makes migration seamless:

```typescript
// Current bootstrap (app bootstrap):
import { liveKitCloudProvider } from './services/recording/providers/liveKitCloudProvider';
import { setRecordingProvider } from './services/recording/recordingService';

setRecordingProvider(liveKitCloudProvider);

// Future switch (single line change):
import { selfHostedProvider } from './services/recording/providers/selfHostedProvider';
setRecordingProvider(selfHostedProvider);
```

No UI components, hooks, or Redux slices need to change. The provider abstraction isolates all LiveKit-specific logic.

### Millions of Recordings

| Concern | Strategy |
|---------|----------|
| DB query performance | Indexes on `(institute_id, status)`, `(teacher_id, status)`, `(batch_id, status)` |
| Storage | Cloudflare R2 (S3-compatible, infinitely scalable) |
| CDN | R2 has built-in CDN; add Cloudflare Workers for geo-routing |
| Signed URLs | Generated on-demand, short-lived (5 min), no DB write |
| Thumbnails | Generated server-side on completion, cached at CDN edge |
| Pagination | Cursor-based for large datasets (>10k recordings) |
| Soft delete → Hard delete | Background job (cron) runs daily, hard-deletes records with `deleted_at < NOW() - 90 days` |
| Webhook reliability | Idempotency key on egress_id, retry queue with exponential backoff |

---

## 16. Deployment Checklist

- [ ] Run migration `065_create_recordings_table.sql` on Supabase
- [ ] Create `recorded-classes` bucket in Cloudflare R2
- [ ] Generate R2 API credentials (Access Key + Secret)
- [ ] Deploy Supabase Edge Function `recording-egress-start`
- [ ] Deploy Supabase Edge Function `recording-egress-stop`
- [ ] Deploy Supabase Edge Function `recording-egress-status`
- [ ] Deploy Supabase Edge Function `recording-playback-url`
- [ ] Configure LiveKit Cloud Egress webhook → Supabase Edge Function
- [ ] Add environment variables to `.env.local`:
  ```env
  NEXT_PUBLIC_LIVEKIT_API_KEY=lkap_xxx
  NEXT_PUBLIC_LIVEKIT_API_SECRET=xxx
  NEXT_PUBLIC_LIVEKIT_WS_URL=wss://xxx.livekit.cloud
  NEXT_PUBLIC_R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
  NEXT_PUBLIC_R2_ACCESS_KEY=xxx
  NEXT_PUBLIC_R2_SECRET_KEY=xxx
  NEXT_PUBLIC_R2_RECORDINGS_BUCKET=recorded-classes
  ```
- [ ] Register recording provider in app bootstrap (`src/lib/providers.tsx`)
- [ ] Add Redux recording slice to store
- [ ] Add navigation routes for teacher and student
- [ ] Verify RLS policies on `recordings` table
- [ ] Test end-to-end flow

---

## 17. Testing Checklist

### Unit Tests

- [ ] `RecordingService.startRecording` — validates input, calls provider, creates DB row
- [ ] `RecordingService.stopRecording` — validates ownership, calls provider, updates DB
- [ ] `RecordingService.getPlaybackUrl` — verifies access, generates signed URL
- [ ] `RecordingService.retryRecording` — only allows retry on `failed` status
- [ ] `RecordingService.handleWebhook` — idempotent, updates correct row

### Integration Tests

- [ ] Teacher starts recording → DB row created with status `recording`
- [ ] LiveKit Egress completes → webhook fires → DB updated to `completed`
- [ ] Teacher views recordings list → shows all recordings filtered by teacher_id
- [ ] Teacher deletes recording → soft-deleted, not shown to students
- [ ] Student views recordings → only sees `completed` recordings in their batches
- [ ] Student clicks play → gets signed URL → video plays (no download)

### End-to-End

- [ ] Teacher creates a live class → goes live → starts recording
- [ ] Teacher teaches for 5+ minutes → stops recording
- [ ] Recording processes → status transitions: recording → processing → completed
- [ ] Student refreshes → sees new recording in their batch
- [ ] Student streams recording → plays without buffering
- [ ] Teacher retries failed recording → new egress started
- [ ] Unauthorized student → 403 on playback URL

### Edge Cases

- [ ] Recording stopped immediately (<3 seconds) → status: 'partial'
- [ ] Network drops during R2 upload → status: 'failed', teacher can retry
- [ ] Teacher ends class → auto-stops recording if active
- [ ] Multiple recordings for same class → handled independently
- [ ] Soft-deleted recording → not visible to students, visible to teacher with badge
- [ ] Signed URL expires → auto-refresh on play attempt

---

> **Document Version:** 1.0  
> **Author:** Freebuff AI  
> **Status:** Implementation Blueprint — Ready for Code Generation
