EdTech Platform — Database Schema Specification
Domain 12: File & Media Management
Tables: media_files · media_versions · media_usage · media_processing_jobs
Document version: 1.0
PostgreSQL target: 16
Supabase compatibility: Yes
Domain sequence: Phase 12 of 15

Domain Overview
Domain 12 modernizes the platform's asset handling by replacing scattered URL strings across content tables with a centralized Media Management system. Instead of storing direct S3 or Supabase Storage links in tables like Content or QuestionImage, every asset is tracked centrally.

This design introduces a logical-to-physical separation:

Logical Media (media_files): The concept of the asset (e.g., "NEET 2023 Physics Lecture").

Physical Versions (media_versions): The actual storage objects (e.g., "1080p stream", "720p stream", "thumbnail image").

Usage Tracking (media_usage): A polymorphic junction linking media to platform entities (Questions, Mock Tests, Content, Profiles).

Processing (media_processing_jobs): Tracking asynchronous transcoding, compression, or watermarking.

This prevents orphaned files, allows global access revocation, supports multi-rendition delivery (HLS/DASH for video), and centralizes storage cost attribution per institute.

New Enum Types Defined in This Domain
Enum Name	Values	Used By	Reason
media_asset_type	video, image, document, audio, archive	media_files.media_type	Categorizes the media for UI handling and player selection.
media_status_type	pending, processing, ready, failed, archived	media_files.status	Tracks the lifecycle of the logical media asset.
media_access_type	public, private, requires_signature	media_files.access_level	Defines storage bucket routing and URL generation rules.
job_category_type	video_transcode, image_compress, pdf_watermark, thumbnail_extract	media_processing_jobs.job_type	Classifies the worker queue task.
job_status_type	queued, running, completed, failed, retrying	media_processing_jobs.status	State machine for asynchronous media workers.
Table 1: media_files
1. Purpose
The master catalog of all media assets uploaded to the platform. This table represents the "logical" file. It acts as the anchor point for permissions, ownership, and tracking, independent of the actual storage bucket or renditions.

2–5. Column Specification
Column	PostgreSQL Type	Nullable	Default	Notes
media_id	UUID	NOT NULL	gen_random_uuid()	Primary key.
institute_id	UUID	NOT NULL	—	FK → institutes.institute_id. Multi-tenant scoping.
uploaded_by	UUID	NOT NULL	—	FK → profiles.profile_id. The user who uploaded the asset.
original_filename	TEXT	NOT NULL	—	The name of the file as uploaded by the user (e.g., physics_ch1_final.mp4).
media_type	media_asset_type	NOT NULL	—	video, image, document, audio, archive.
status	media_status_type	NOT NULL	'pending'	Current readiness state of the media.
access_level	media_access_type	NOT NULL	'requires_signature'	Security context for URL generation.
total_size_bytes	BIGINT	NOT NULL	0	Sum of all associated media_versions sizes. Updated via triggers.
duration_seconds	INTEGER	NULL	NULL	Applicable for video and audio. NULL for documents/images.
is_active	BOOLEAN	NOT NULL	TRUE	Soft delete flag.
created_at	TIMESTAMPTZ	NOT NULL	NOW()	Timestamp of record creation.
updated_at	TIMESTAMPTZ	NOT NULL	NOW()	Last modification timestamp.
6. Primary Key
PRIMARY KEY (media_id)

7. Foreign Keys
institute_id → institutes.institute_id (ON DELETE RESTRICT ON UPDATE RESTRICT)

uploaded_by → profiles.profile_id (ON DELETE RESTRICT ON UPDATE RESTRICT)

8. Composite Keys
None.

9. Unique Constraints
None. Users can upload multiple files with the same name.

10. CHECK Constraints
CHECK (total_size_bytes >= 0)

CHECK (duration_seconds IS NULL OR duration_seconds >= 0)

CHECK (char_length(original_filename) > 0 AND char_length(original_filename) <= 255)

11. Recommended Indexes
idx_media_institute_type (institute_id, media_type, status): Admin media library filtering.

idx_media_uploader (uploaded_by, created_at DESC): Filtering "My Uploads".

12. Soft Delete Strategy
is_active = FALSE. Sets the file as deleted in the UI but preserves the record until a backend cron job physically deletes the underlying bucket objects and hard-deletes the record (Data Retention Policy).

13. Audit Fields
created_at, updated_at, uploaded_by (Attribution).

14. Cascade Rules
DELETE institutes: RESTRICT.

DELETE profiles: RESTRICT. (Media should be reassigned, not orphaned).

15. Supabase RLS Considerations
Admins: Can read/update all media within their institute_id.

Teachers: Can read all is_active = TRUE media in their institute; can only update media they uploaded (uploaded_by = auth.uid()).

Students: Should rarely query this table directly; they access media via Content or LiveClass queries, but can read if status = 'ready' and mapped to allowed content.

16. Notes for Backend Developers
Never expose direct Supabase Storage URLs to the client. Always pass the media_id. Let a signed-URL generator endpoint validate access and return the short-lived CDN URL.

The total_size_bytes must be maintained via a database trigger that fires upon inserts/deletes into media_versions.

Table 2: media_versions
1. Purpose
Tracks the physical files stored in buckets (e.g., Supabase Storage / AWS S3) that belong to a logical media_id. A single video upload might have four versions: original, 1080p, 720p, and a thumbnail.

2–5. Column Specification
Column	PostgreSQL Type	Nullable	Default	Notes
version_id	UUID	NOT NULL	gen_random_uuid()	Primary key.
media_id	UUID	NOT NULL	—	FK → media_files.media_id.
version_label	TEXT	NOT NULL	—	e.g., 'original', '1080p', '720p', 'thumbnail', 'watermarked'.
storage_bucket	TEXT	NOT NULL	—	The name of the storage bucket (e.g., institute_private_assets).
storage_path	TEXT	NOT NULL	—	The exact path/key inside the bucket.
mime_type	TEXT	NOT NULL	—	e.g., application/pdf, video/mp4, image/webp.
file_size_bytes	BIGINT	NOT NULL	—	Exact size of this specific rendition.
checksum	TEXT	NULL	NULL	MD5 or SHA256 hash for data integrity.
created_at	TIMESTAMPTZ	NOT NULL	NOW()	Timestamp of creation.
6. Primary Key
PRIMARY KEY (version_id)

7. Foreign Keys
media_id → media_files.media_id (ON DELETE CASCADE ON UPDATE RESTRICT)

8. Composite Keys
None.

9. Unique Constraints
UNIQUE (media_id, version_label): A logical file can only have one version labelled '720p', one 'original', etc.

UNIQUE (storage_bucket, storage_path): Prevents two version records from pointing to the exact same physical file.

10. CHECK Constraints
CHECK (file_size_bytes >= 0)

CHECK (char_length(version_label) > 0)

11. Recommended Indexes
idx_media_versions_media_id (media_id): Covered partially by unique constraint, but good for joins.

idx_media_versions_storage (storage_bucket, storage_path): Covered by unique constraint.

12. Soft Delete Strategy
No soft delete. When a version is removed or replaced, it is hard-deleted from this table (and physically removed from the bucket via storage webhooks).

13. Audit Fields
created_at. No updated_at as versions are immutable (if a file changes, a new version is created).

14. Cascade Rules
DELETE media_files: CASCADE. Removing the logical file removes all physical file records.

15. Supabase RLS Considerations
Usually restricted to service_role for writing (handled by media processing workers).

Read access mirrors media_files via a join.

16. Notes for Backend Developers
The version_label = 'original' is sacred. If a user deletes the 1080p version, it can be regenerated from original. If original is deleted, it cannot be recovered.

Use Supabase Storage webhooks to ensure that when a file is physically deleted from a bucket, the corresponding media_versions row is deleted.

Table 3: media_usage
1. Purpose
A polymorphic junction table that tracks exactly where every media file is being used across the platform. This is critical for data hygiene: you cannot safely delete a media file if you do not know if it is currently linked to a Mock Test, a Question, or a Course.

2–5. Column Specification
Column	PostgreSQL Type	Nullable	Default	Notes
usage_id	UUID	NOT NULL	gen_random_uuid()	Primary key.
media_id	UUID	NOT NULL	—	FK → media_files.media_id.
resource_type	TEXT	NOT NULL	—	Target entity table name (e.g., 'content', 'question', 'profile', 'live_class').
resource_id	UUID	NOT NULL	—	The UUID of the target entity row.
usage_context	TEXT	NULL	NULL	How it's used (e.g., 'avatar', 'video_lecture', 'question_diagram').
created_at	TIMESTAMPTZ	NOT NULL	NOW()	Timestamp of record creation.
6. Primary Key
PRIMARY KEY (usage_id)

7. Foreign Keys
media_id → media_files.media_id (ON DELETE RESTRICT ON UPDATE RESTRICT): Cannot delete media that is actively in use.

8. Composite Keys
None.

9. Unique Constraints
UNIQUE (media_id, resource_type, resource_id, usage_context): Prevents duplicate linking of the same media to the same resource in the same context.

10. CHECK Constraints
CHECK (char_length(resource_type) > 0)

11. Recommended Indexes
idx_media_usage_polymorphic (resource_type, resource_id): Quick lookup to find all media attached to a specific Question or Content block.

idx_media_usage_media_id (media_id): Lookup to see where a specific media file is used (orphan checking).

12. Soft Delete Strategy
No soft delete. Hard delete the row when the media is unlinked from the resource.

13. Audit Fields
created_at.

14. Cascade Rules
Polymorphic references (resource_id) do not have database-level cascading. Application logic must delete media_usage rows when the parent resource is deleted.

15. Supabase RLS Considerations
Read access is granted if the user has read access to the underlying resource_type and resource_id. (Often bypassed in backend middleware, but must be strict if exposed to the frontend).

Write access is restricted to service_role or authorized authors of the resource.

16. Notes for Backend Developers
Because PostgreSQL does not support polymorphic foreign keys natively, referential integrity on resource_id is lost at the DB layer. You must use application-level logic or DB triggers to ensure cleanups when Questions or Content rows are deleted.

Before deleting a media_files row, query this table. If rows exist, block the deletion and return an error: "Asset is currently in use."

Table 4: media_processing_jobs
1. Purpose
Tracks the state of asynchronous media tasks like AWS MediaConvert jobs, FFmpeg transcoding, PDF compression, or thumbnail extraction. Provides visibility into the media pipeline.

2–5. Column Specification
Column	PostgreSQL Type	Nullable	Default	Notes
job_id	UUID	NOT NULL	gen_random_uuid()	Primary key.
media_id	UUID	NOT NULL	—	FK → media_files.media_id.
job_type	job_category_type	NOT NULL	—	e.g., video_transcode.
status	job_status_type	NOT NULL	'queued'	Current state of the job.
worker_id	TEXT	NULL	NULL	ID of the external worker or service handling the job (e.g., AWS Job ID).
progress_percent	SMALLINT	NOT NULL	0	0-100 progress indicator.
error_log	TEXT	NULL	NULL	Stack trace or API error message if the job fails.
started_at	TIMESTAMPTZ	NULL	NULL	When the worker picked up the job.
completed_at	TIMESTAMPTZ	NULL	NULL	When the job successfully finished or fatally failed.
created_at	TIMESTAMPTZ	NOT NULL	NOW()	When the job was requested.
6. Primary Key
PRIMARY KEY (job_id)

7. Foreign Keys
media_id → media_files.media_id (ON DELETE CASCADE ON UPDATE RESTRICT)

8. Composite Keys
None.

9. Unique Constraints
None. Multiple jobs (e.g., thumbnail extraction and transcoding) can run simultaneously for the same media.

10. CHECK Constraints
CHECK (progress_percent >= 0 AND progress_percent <= 100)

CHECK ((status IN ('completed', 'failed') AND completed_at IS NOT NULL) OR (status NOT IN ('completed', 'failed')))

11. Recommended Indexes
idx_media_jobs_status (status, created_at): Used by worker processes polling for queued or retrying jobs.

idx_media_jobs_media (media_id, status): Quick lookup to check if a specific media file has pending operations.

12. Soft Delete Strategy
No soft delete. Jobs are historical logs. Routine data purging (e.g., deleting successful jobs older than 30 days) should be handled via a cron job.

13. Audit Fields
started_at, completed_at, created_at.

14. Cascade Rules
DELETE media_files: CASCADE. If the media is deleted, cancel and drop related processing logs.

15. Supabase RLS Considerations
No client access.

Read/Write is entirely restricted to service_role and background processing workers.

16. Notes for Backend Developers
When a job's status changes to completed, a trigger or webhook should automatically update the status of the parent media_files row to ready if all required jobs for that media are finished.

Use SKIP LOCKED in PostgreSQL if polling this table with multiple concurrent worker instances to prevent job doubling.

Domain 12 — File & Media Management is complete.
Awaiting your approval before proceeding to the next domain.