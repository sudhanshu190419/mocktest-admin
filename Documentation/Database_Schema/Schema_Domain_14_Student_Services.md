# EdTech Platform — Database Schema Specification
## Domain 14: Student Services
### Tables: `student_bookmarks` · `student_downloads` · `student_viewing_history` · `student_personal_notes` · `student_doubts` · `doubt_replies` · `support_tickets` · `support_ticket_messages` · `student_feedback_ratings`

**Document version:** 1.0
**ERD reference:** ERD v2.0 Extensions (Student Engagement & Support)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 14 of 15

---

## Domain Overview

Domain 14 covers all the peripheral but essential services that drive student engagement, retention, and support. It transforms the platform from a passive content repository into an interactive learning environment. 

This domain handles:
- **Personalization & Tracking:** Bookmarks/favorites, offline downloads, and resume-playback history (`recently_viewed`).
- **Active Learning:** Personal notes tied to specific video timestamps or content blocks.
- **Academic Support:** A structured Doubt/Q&A forum where students can ask questions and teachers/peers can reply.
- **Customer Service:** A ticketing system for billing, technical, or account issues.
- **Quality Assurance:** 5-star ratings and feedback for classes, teachers, and content.

Because this domain is heavily student-centric, **Row Level Security (RLS)** and **Data Partitioning** are critical. Tables like `student_viewing_history` and `student_downloads` will grow massively and must be optimized for high-frequency write/upsert patterns.

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `resource_category_type` | `content`, `question`, `live_class`, `pyq_paper`, `mock_test`, `teacher` | Bookmarks, Notes, History, Ratings | Standardizes polymorphic references across the student services domain. |
| `doubt_status_type` | `open`, `in_progress`, `resolved`, `archived` | `student_doubts.status` | Workflow state for the academic doubt resolution engine. |
| `ticket_category_type` | `billing`, `technical`, `academic`, `account`, `other` | `support_tickets.category` | Routes customer support issues to the right admin queues. |
| `ticket_status_type` | `open`, `in_progress`, `waiting_on_student`, `resolved`, `closed` | `support_tickets.status` | Standard helpdesk state machine. |
| `ticket_priority_type` | `low`, `medium`, `high`, `urgent` | `support_tickets.priority` | SLA management for support tickets. |

---

## Table 1: `student_bookmarks`

### 1. Purpose
Replaces generic "favorites". Allows students to save Questions, Live Classes, PDF Notes, or PYQ Papers for quick access later. Supports lightweight organization via folders.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `bookmark_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. |
| `resource_type` | `resource_category_type` | NOT NULL | — | Type of item being bookmarked. |
| `resource_id` | `UUID` | NOT NULL | — | The ID of the bookmarked item. |
| `folder_name` | `TEXT` | NOT NULL | `'General'` | Allows students to group bookmarks (e.g., "Hard Physics Questions"). |
| `notes` | `TEXT` | NULL | `NULL` | Brief reminder of why they saved it (e.g., "Review before exam"). |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp of bookmark creation. |

### 6. Primary Key
`PRIMARY KEY (bookmark_id)`

### 7. Foreign Keys
* `student_id → student_details.student_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
`UNIQUE (student_id, resource_type, resource_id)`
> A student can only bookmark a specific resource once.

### 10. CHECK Constraints
* `CHECK (char_length(folder_name) > 0 AND char_length(folder_name) <= 50)`

### 11. Recommended Indexes
* `idx_bookmarks_student_folder` `(student_id, folder_name)`: Used for rendering the student's bookmark directory.

### 12. Soft Delete Strategy
No soft delete. When a student "un-bookmarks" an item, the row is hard deleted.

### 13. Audit Fields
* `created_at`. 

### 14. Cascade Rules
* DELETE `student_details`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `ALL` where `student_id = auth.uid()` (via profile lookup).
* **Admins/Teachers:** Blocked (Bookmarks are private to the student).

### 16. Notes for Backend Developers
* Polymorphic relationships (`resource_type`, `resource_id`) lack DB-level foreign key constraints. The backend must handle orphaned bookmarks if the underlying `Content` or `Question` is deleted.

---

## Table 2: `student_downloads`

### 1. Purpose
Tracks DRM and offline media usage. When a student downloads a video or PDF to their mobile app for offline viewing, it is logged here to enforce device limits and offline expiry (preventing content piracy).

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `download_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. |
| `resource_type` | `resource_category_type` | NOT NULL | — | Usually `content` or `pyq_paper`. |
| `resource_id` | `UUID` | NOT NULL | — | The ID of the downloaded content. |
| `device_id` | `TEXT` | NOT NULL | — | Unique identifier of the mobile device (used for DRM limits). |
| `downloaded_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | When the download occurred. |
| `expires_at` | `TIMESTAMPTZ` | NULL | `NULL` | When the offline DRM lease expires (e.g., in 30 days). |
| `is_revoked` | `BOOLEAN` | NOT NULL | `FALSE` | Allows admins to remotely wipe downloaded content access. |

### 6. Primary Key
`PRIMARY KEY (download_id)`

### 7. Foreign Keys
* `student_id → student_details.student_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
`UNIQUE (student_id, resource_type, resource_id, device_id)`
> Tracks unique downloads per device, per student, per resource. Upsert on re-download.

### 10. CHECK Constraints
* `CHECK (expires_at IS NULL OR expires_at > downloaded_at)`

### 11. Recommended Indexes
* `idx_downloads_student_device` `(student_id, device_id)`: Validating DRM limits (e.g., "Max 2 devices for offline downloads").

### 12. Soft Delete Strategy
No soft delete. Hard delete if the student clears their local downloads via the app.

### 13. Audit Fields
* `downloaded_at`.

### 14. Cascade Rules
* DELETE `student_details`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `SELECT`, `INSERT`, `UPDATE` (for extending lease) where `student_id = auth.uid()`.
* **Admins:** `ALL`.

### 16. Notes for Backend Developers
* Enforce a max device limit in the backend (e.g., count distinct `device_id` for a `student_id`). If they exceed it, reject the download or force them to de-register an old device.

---

## Table 3: `student_viewing_history`

### 1. Purpose
"Recently Viewed" and "Resume Playback" functionality. This is a high-volume UPSERT table that tracks exactly where a student left off in a video, or the last time they opened a PDF. 

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `history_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. |
| `resource_type` | `resource_category_type` | NOT NULL | — | Type of content (e.g., `live_class` recording or `content` video). |
| `resource_id` | `UUID` | NOT NULL | — | The ID of the content. |
| `last_position_seconds` | `INTEGER` | NOT NULL | `0` | Where to resume playback. 0 for non-video content. |
| `is_completed` | `BOOLEAN` | NOT NULL | `FALSE` | Set to TRUE when progress exceeds ~90%. |
| `viewed_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last interaction time. |

### 6. Primary Key
`PRIMARY KEY (history_id)`

### 7. Foreign Keys
* `student_id → student_details.student_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
`UNIQUE (student_id, resource_type, resource_id)`
> Enables fast `ON CONFLICT DO UPDATE SET last_position_seconds = EXCLUDED.last_position_seconds, viewed_at = NOW()`

### 10. CHECK Constraints
* `CHECK (last_position_seconds >= 0)`

### 11. Recommended Indexes
* `idx_history_student_viewed` `(student_id, viewed_at DESC)`: To load the "Continue Learning" / "Recently Viewed" carousel on the student dashboard.

### 12. Soft Delete Strategy
No soft delete. History stays unless the account is deleted.

### 13. Audit Fields
* `viewed_at`.

### 14. Cascade Rules
* DELETE `student_details`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `SELECT`, `INSERT`, `UPDATE` for their own ID.
* **Admins/Teachers:** `SELECT` to monitor student engagement.

### 16. Notes for Backend Developers
* This endpoint is called constantly (e.g., every 15 seconds during video playback). Do **not** hit PostgreSQL directly for every ping. Buffer progress in Redis or memory, and flush to this table on a cadence (e.g., every 60 seconds) or when the user pauses/closes the tab.

---

## Table 4: `student_personal_notes`

### 1. Purpose
Allows students to write rich-text personal notes attached to a specific video or document. Includes timestamp integration so clicking the note jumps the video player to the correct time.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `note_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. |
| `resource_type` | `resource_category_type` | NOT NULL | — | The content the note belongs to. |
| `resource_id` | `UUID` | NOT NULL | — | The target entity ID. |
| `video_timestamp_seconds` | `INTEGER` | NULL | `NULL` | If the note is for a video, the exact time it references. |
| `note_content` | `TEXT` | NOT NULL | — | Rich text/Markdown content of the note. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp of creation. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. |

### 6. Primary Key
`PRIMARY KEY (note_id)`

### 7. Foreign Keys
* `student_id → student_details.student_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
None. A student can take multiple notes on the same resource.

### 10. CHECK Constraints
* `CHECK (video_timestamp_seconds IS NULL OR video_timestamp_seconds >= 0)`
* `CHECK (char_length(note_content) > 0)`

### 11. Recommended Indexes
* `idx_notes_student_resource` `(student_id, resource_type, resource_id)`: Fetches all personal notes for the currently active video/document.

### 12. Soft Delete Strategy
No soft delete. Explicit delete by the student is permanent.

### 13. Audit Fields
* `created_at`, `updated_at`.

### 14. Cascade Rules
* DELETE `student_details`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `ALL` for their own ID. 
* **Admins/Teachers:** Blocked (Personal notes are strictly private).

### 16. Notes for Backend Developers
* Protect against large payload abuse. Restrict `note_content` length via application logic or a DB check constraint (e.g., `CHECK (char_length(note_content) <= 10000)`).

---

## Table 5: `student_doubts`

### 1. Purpose
The core of the academic Q&A engine. Students ask doubts related to a subject, chapter, or a specific piece of content (like a Question ID). Forms the top level of a threaded discussion.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `doubt_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. |
| `subject_id` | `UUID` | NOT NULL | — | FK → `subjects.subject_id` (Domain 3). Context is required. |
| `chapter_id` | `UUID` | NULL | `NULL` | FK → `chapters.chapter_id` (Domain 3). Optional deeper context. |
| `related_resource_type` | `resource_category_type` | NULL | `NULL` | (Optional) Did they ask this from a specific mock test question? |
| `related_resource_id` | `UUID` | NULL | `NULL` | (Optional) The specific entity ID. |
| `title` | `TEXT` | NOT NULL | — | Short summary of the doubt. |
| `description` | `TEXT` | NOT NULL | — | Detailed explanation, supports Markdown/LaTeX. |
| `image_url` | `TEXT` | NULL | `NULL` | Optional attached screenshot (references Domain 12 Media). |
| `status` | `doubt_status_type` | NOT NULL | `'open'` | Workflow status. |
| `resolved_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The teacher/admin who resolved it. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. |

### 6. Primary Key
`PRIMARY KEY (doubt_id)`

### 7. Foreign Keys
* `student_id → student_details.student_id (ON DELETE CASCADE ON UPDATE RESTRICT)`
* `subject_id → subjects.subject_id (ON DELETE RESTRICT ON UPDATE RESTRICT)`
* `resolved_by → profiles.profile_id (ON DELETE SET NULL ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
None.

### 10. CHECK Constraints
* `CHECK (char_length(title) >= 5 AND char_length(title) <= 200)`
* `CHECK ( (status = 'resolved' AND resolved_by IS NOT NULL) OR (status != 'resolved') )`

### 11. Recommended Indexes
* `idx_doubts_subject_status` `(subject_id, status)`: Used by Teachers to find open doubts for their assigned subjects.
* `idx_doubts_student` `(student_id, created_at DESC)`: Student's dashboard "My Doubts" section.

### 12. Soft Delete Strategy
Hard delete allowed by the author if no replies exist. Otherwise, status transitions to `archived` to preserve the knowledge base.

### 13. Audit Fields
* `created_at`, `updated_at`.

### 14. Cascade Rules
* DELETE `student_details`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `SELECT` all (community forum), `INSERT`/`UPDATE` their own.
* **Teachers:** `ALL` for doubts in their assigned subjects.

### 16. Notes for Backend Developers
* Integrate LaTeX rendering securely on the frontend. The `description` field will often contain raw math strings (e.g., `$\int x dx$`).

---

## Table 6: `doubt_replies`

### 1. Purpose
The replies/comments on a `student_doubt`. Can be posted by the original student, other peer students, or a teacher.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `reply_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `doubt_id` | `UUID` | NOT NULL | — | FK → `student_doubts.doubt_id`. |
| `author_profile_id` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. Can be student, teacher, or admin. |
| `reply_text` | `TEXT` | NOT NULL | — | The response content (Markdown/LaTeX). |
| `image_url` | `TEXT` | NULL | `NULL` | Optional supporting image. |
| `is_accepted_answer` | `BOOLEAN` | NOT NULL | `FALSE` | Marked TRUE by the original student or a teacher to highlight the best answer. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. |

### 6. Primary Key
`PRIMARY KEY (reply_id)`

### 7. Foreign Keys
* `doubt_id → student_doubts.doubt_id (ON DELETE CASCADE ON UPDATE RESTRICT)`
* `author_profile_id → profiles.profile_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
None.

### 10. CHECK Constraints
* `CHECK (char_length(reply_text) > 0)`

### 11. Recommended Indexes
* `idx_doubt_replies_doubt` `(doubt_id, created_at ASC)`: Fetch threaded replies in chronological order.

### 12. Soft Delete Strategy
Standard hard delete allowed by author. 

### 13. Audit Fields
* `created_at`, `updated_at`.

### 14. Cascade Rules
* DELETE `student_doubts`: CASCADE.

### 15. Supabase RLS Considerations
* **All Users:** `SELECT` to view threads.
* **Original Author / Admins:** Can UPDATE `is_accepted_answer = TRUE`.

### 16. Notes for Backend Developers
* When a reply is marked `is_accepted_answer = TRUE`, the backend should automatically trigger an UPDATE on the parent `student_doubts` table to set `status = 'resolved'` and `resolved_by = author_profile_id`.

---

## Table 7: `support_tickets`

### 1. Purpose
A formal helpdesk for non-academic issues (e.g., "I was double charged", "The app is crashing", "Change my batch"). 

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `ticket_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. |
| `category` | `ticket_category_type` | NOT NULL | — | billing, technical, etc. |
| `priority` | `ticket_priority_type` | NOT NULL | `'medium'` | Dictates SLA/response time. |
| `status` | `ticket_status_type` | NOT NULL | `'open'` | Workflow state. |
| `subject` | `TEXT` | NOT NULL | — | Summary of the issue. |
| `assigned_to` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin/support agent handling it. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. |

### 6. Primary Key
`PRIMARY KEY (ticket_id)`

### 7. Foreign Keys
* `student_id → student_details.student_id (ON DELETE CASCADE ON UPDATE RESTRICT)`
* `assigned_to → profiles.profile_id (ON DELETE SET NULL ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
None.

### 10. CHECK Constraints
* `CHECK (char_length(subject) > 0)`

### 11. Recommended Indexes
* `idx_tickets_status_priority` `(status, priority)`: Used by the admin support dashboard to triage urgent issues.
* `idx_tickets_student` `(student_id, created_at DESC)`: Student's support history.

### 12. Soft Delete Strategy
No soft delete. Resolved tickets are marked `closed`.

### 13. Audit Fields
* `created_at`, `updated_at`.

### 14. Cascade Rules
* DELETE `student_details`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `SELECT` and `INSERT` for their own `student_id`.
* **Admins:** `ALL`.
* **Teachers:** Blocked (Teachers do not handle billing/technical support).

### 16. Notes for Backend Developers
* Send real-time notifications to the student (via Domain 13 Notifications) whenever the `status` changes or an admin is `assigned_to` the ticket.

---

## Table 8: `support_ticket_messages`

### 1. Purpose
The conversational back-and-forth log for a `support_ticket`.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `message_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `ticket_id` | `UUID` | NOT NULL | — | FK → `support_tickets.ticket_id`. |
| `sender_profile_id` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. (Admin or Student). |
| `message_body` | `TEXT` | NOT NULL | — | The actual text of the message. |
| `attachment_url` | `TEXT` | NULL | `NULL` | Optional screenshot/receipt link. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Timestamp. |

### 6. Primary Key
`PRIMARY KEY (message_id)`

### 7. Foreign Keys
* `ticket_id → support_tickets.ticket_id (ON DELETE CASCADE ON UPDATE RESTRICT)`
* `sender_profile_id → profiles.profile_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
None.

### 10. CHECK Constraints
* `CHECK (char_length(message_body) > 0)`

### 11. Recommended Indexes
* `idx_ticket_messages_ticket` `(ticket_id, created_at ASC)`: Load the conversation history.

### 12. Soft Delete Strategy
Messages cannot be deleted to ensure an immutable customer service audit trail.

### 13. Audit Fields
* `created_at`.

### 14. Cascade Rules
* DELETE `support_tickets`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `SELECT`, `INSERT` if they own the parent ticket.
* **Admins:** `ALL`.

### 16. Notes for Backend Developers
* When an admin inserts a message, automatically update the parent `support_tickets.status` to `waiting_on_student`. When a student replies, update it back to `in_progress`.

---

## Table 9: `student_feedback_ratings`

### 1. Purpose
Collects 1-to-5 star ratings and reviews for platform entities (Live Classes, Teachers, Mock Tests, Content). This fuels the aggregate ratings displayed on teacher profiles and content dashboards.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `feedback_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `student_id` | `UUID` | NOT NULL | — | FK → `student_details.student_id`. |
| `target_type` | `resource_category_type` | NOT NULL | — | E.g., `teacher`, `live_class`, `content`. |
| `target_id` | `UUID` | NOT NULL | — | The ID of the item being rated. |
| `rating` | `SMALLINT` | NOT NULL | — | Numeric score from 1 to 5. |
| `review_text` | `TEXT` | NULL | `NULL` | Optional written feedback. |
| `is_public` | `BOOLEAN` | NOT NULL | `TRUE` | If TRUE, can be displayed as a testimonial. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. |

### 6. Primary Key
`PRIMARY KEY (feedback_id)`

### 7. Foreign Keys
* `student_id → student_details.student_id (ON DELETE CASCADE ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
`UNIQUE (student_id, target_type, target_id)`
> A student can only rate a specific entity (like a single class or teacher) once. Upsert to change the rating.

### 10. CHECK Constraints
* `CHECK (rating >= 1 AND rating <= 5)`

### 11. Recommended Indexes
* `idx_feedback_target` `(target_type, target_id, rating)`: Very useful for aggregating averages quickly.

### 12. Soft Delete Strategy
No soft delete.

### 13. Audit Fields
* `created_at`, `updated_at`.

### 14. Cascade Rules
* DELETE `student_details`: CASCADE.

### 15. Supabase RLS Considerations
* **Students:** `INSERT`/`UPDATE` for their own ID.
* **Public/All Users:** `SELECT` where `is_public = TRUE`.
* **Admins/Teachers:** `SELECT` all for analytics.

### 16. Notes for Backend Developers
* **Performance:** Do not calculate aggregate ratings on the fly using `AVG(rating)` over millions of rows during user browsing. Instead, run a nightly CRON job (or use database triggers) to calculate the average and update a cached `average_rating` field on the target table (e.g., `teacher_details.rating`).

---