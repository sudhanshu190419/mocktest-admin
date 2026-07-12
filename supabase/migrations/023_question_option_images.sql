-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 023: Question Option Images
--
-- Adds support for image-based question options while keeping the current
-- architecture normalized. Introduces a dedicated `question_option_images`
-- table (separate from `question_images`) to store images linked directly
-- to specific option rows.
--
-- Key design decisions:
--   - `question_option_images` is a NEW table, not an extension of
--     `question_images`. This preserves the existing image model for
--     stem and explanation images without schema coupling.
--   - `option_text` on `question_options` is made nullable to support
--     image-only options (text stays NOT NULL for existing rows).
--   - Reuses the existing `question-images` Supabase Storage bucket.
--   - Path pattern: questions/{instituteId}/{questionId}/options/{optionId}/{imageId}.{ext}
--
-- Dependencies:
--   Domain 5 (Assessment) — questions, question_options, question_images
--   Domain 1 (Foundation) — institutes, profiles, teacher_details
--   Pre-existing RLS helper functions:
--     get_my_teacher_id(), get_my_institute_id()
--   Pre-existing storage bucket: `question-images`
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  1. ALTER question_options.option_text TO ALLOW NULL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Rationale: to support image-only options (no text), `option_text` must
-- be nullable. A question can have:
--   - Text-only options:          option_text = '(A) Newton's First Law', no images
--   - Image-only options:         option_text = NULL, 1+ images
--   - Text + Image options:       option_text = '(A) Diagram below', 1+ images
--
-- Existing rows are unaffected — the column is only made nullable for
-- new inserts. The previous CHECK constraint (char_length >= 1) is
-- relaxed to allow NULL values.

ALTER TABLE question_options
  DROP CONSTRAINT IF EXISTS question_options_option_text_check;

ALTER TABLE question_options
  ADD CONSTRAINT question_options_option_text_check
    CHECK (option_text IS NULL OR char_length(option_text) >= 1);

ALTER TABLE question_options
  ALTER COLUMN option_text DROP NOT NULL;

COMMENT ON COLUMN question_options.option_text IS
  'Option content in plain text or Markdown. NULL for image-only options. '
  'At least one of option_text or a row in question_option_images must be non-null. '
  'Enforced at the application layer.';


-- ═══════════════════════════════════════════════════════════════════════════
--  2. CREATE question_option_images TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS question_option_images (
  -- Primary key
  option_image_id   UUID        NOT NULL DEFAULT gen_random_uuid(),

  -- Foreign keys
  option_id         UUID        NOT NULL,
  institute_id      UUID        NOT NULL,

  -- Storage metadata (mirrors the pattern used by question_images)
  storage_bucket    TEXT        NOT NULL,
  storage_path      TEXT        NOT NULL,

  -- Display-ready URL. May be a signed URL refreshed periodically or a
  -- public URL depending on the bucket's access policy. Stored here for
  -- fast display without joining to a URL-generation service.
  

  -- Accessibility description. Required for WCAG 2.1 Level AA compliance.
  -- Should be populated before the parent question is published.
  alt_text          TEXT        NULL,

  -- Display order when an option has multiple images. 1-indexed.
  -- Intentionally named `display_order` (not `order_sequence` as in
  -- question_images) because this column orders images WITHIN an option,
  -- not options within a question. The distinct name avoids confusion
  -- when both tables are joined in the same query.
  display_order     INTEGER     NOT NULL DEFAULT 1,

  -- Timestamp
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Constraints ──────────────────────────────────────────────────────

  CONSTRAINT question_option_images_pkey
    PRIMARY KEY (option_image_id),

  CONSTRAINT fk_question_option_images_option
    FOREIGN KEY (option_id)
    REFERENCES question_options (option_id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,

  CONSTRAINT fk_question_option_images_institute
    FOREIGN KEY (institute_id)
    REFERENCES institutes (institute_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,

  CONSTRAINT question_option_images_storage_bucket_check
    CHECK (char_length(storage_bucket) >= 1),

  CONSTRAINT question_option_images_storage_path_check
    CHECK (char_length(storage_path) >= 1),

  CONSTRAINT question_option_images_display_order_check
    CHECK (display_order >= 1)
);


-- ═══════════════════════════════════════════════════════════════════════════
--  3. COMMENTS
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE question_option_images IS
  'Images associated with a specific question option — diagrams, graphs, '
  'chemical structures, circuit diagrams, biology figures, or any visual '
  'content embedded in an answer choice. 1:M relationship with question_options. '
  'A single option may have multiple images (e.g., a diagram series, or both '
  'a PNG and an SVG rendition). '
  'This table is intentionally separate from question_images, which continues '
  'to serve stem and explanation images only.';

COMMENT ON COLUMN question_option_images.option_image_id
  IS 'Primary key. Generated client-side for idempotent upload workflows.';

COMMENT ON COLUMN question_option_images.option_id
  IS 'FK → question_options.option_id. Links the image to its parent option. '
     'ON DELETE CASCADE — if the option is removed (via question archive + cleanup), '
     'its images are removed automatically.';

COMMENT ON COLUMN question_option_images.institute_id
  IS 'FK → institutes.institute_id. Denormalized for RLS performance and '
     'multi-tenant index isolation. Copied from the parent option at insert time.';

COMMENT ON COLUMN question_option_images.storage_bucket
  IS 'Supabase Storage bucket name. Uses the shared question-images bucket. '
     'Consistent with the storage model in question_images.';

COMMENT ON COLUMN question_option_images.storage_path
  IS 'Object path within storage_bucket. Follows the convention: '
     'questions/{instituteId}/{questionId}/options/{optionId}/{imageId}.{ext}. '
     'Signed URLs are generated dynamically from this path at serve time.';



COMMENT ON COLUMN question_option_images.alt_text
  IS 'Accessibility description of the image. Required for WCAG 2.1 Level AA '
     'compliance. NULL during draft authoring; should be populated before '
     'the parent question is published.';

COMMENT ON COLUMN question_option_images.display_order
  IS 'Display order when an option has multiple images. 1-indexed. For options '
     'with a single image, display_order = 1 is the default. Allows future '
     'support for multiple images per option (diagram series, alternate views).';

COMMENT ON COLUMN question_option_images.created_at
  IS 'UTC timestamp when the image record was created.';


-- ═══════════════════════════════════════════════════════════════════════════
--  4. INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- Primary lookup: all images for a given option (sort by display order)
CREATE INDEX IF NOT EXISTS idx_question_option_images_option_id
  ON question_option_images (option_id);

-- Institute-scoped queries for admin and analytics
CREATE INDEX IF NOT EXISTS idx_question_option_images_institute_id
  ON question_option_images (institute_id);

-- Composite index for ordered option image fetching (the primary read pattern)
CREATE INDEX IF NOT EXISTS idx_question_option_images_option_display
  ON question_option_images (option_id, display_order);


-- ═══════════════════════════════════════════════════════════════════════════
--  5. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE question_option_images ENABLE ROW LEVEL SECURITY;

-- ── 5a. SELECT policies ─────────────────────────────────────────────────

-- Teachers: May SELECT option images for any option in a question they
-- created OR any published question within their institute.
CREATE POLICY "Teachers can select option images for own or published questions"
  ON question_option_images
  FOR SELECT
  USING (
    institute_id = get_my_institute_id()
    AND (
      -- Own questions (any status)
      option_id IN (
        SELECT qo.option_id
        FROM question_options qo
        JOIN questions q ON q.question_id = qo.question_id
        WHERE q.created_by = get_my_teacher_id()
      )
      OR
      -- Published questions (shared bank)
      option_id IN (
        SELECT qo.option_id
        FROM question_options qo
        JOIN questions q ON q.question_id = qo.question_id
        WHERE q.status = 'published'
      )
    )
  );

-- Admins: May SELECT all option images within their institute.
CREATE POLICY "Admins can select all option images in their institute"
  ON question_option_images
  FOR SELECT
  USING (
    institute_id = get_my_institute_id()
    AND is_admin()
);

-- Students: May SELECT option images for published questions only within
-- their institute. This is a defence-in-depth layer — the primary access
-- path for students goes through the attempt Edge Function, not direct
-- table SELECTs. The institute_id filter prevents cross-tenant reads even
-- if the parent question's RLS were bypassed.
CREATE POLICY "Students can select option images for published questions"
  ON question_option_images
  FOR SELECT
  USING (
    institute_id = get_my_institute_id()
    AND option_id IN (
      SELECT qo.option_id
      FROM question_options qo
      JOIN questions q ON q.question_id = qo.question_id
      WHERE q.status = 'published'
    )
  );

-- ── 5b. INSERT policies ─────────────────────────────────────────────────

-- Teachers: May INSERT option images only for options belonging to questions
-- they created (draft or pending_approval only — published is immutable).
CREATE POLICY "Teachers can insert option images for own draft questions"
  ON question_option_images
  FOR INSERT
  WITH CHECK (
    institute_id = get_my_institute_id()
    AND option_id IN (
      SELECT qo.option_id
      FROM question_options qo
      JOIN questions q ON q.question_id = qo.question_id
      WHERE q.created_by = get_my_teacher_id()
        AND q.status IN ('draft', 'pending_approval')
    )
  );

-- Admins: May INSERT option images for any question within their institute.
CREATE POLICY "Admins can insert option images"
  ON question_option_images
  FOR INSERT
  WITH CHECK (
    institute_id = get_my_institute_id()
    AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'
  );

-- ── 5c. UPDATE policies ──────────────────────────────────────────────────

-- Teachers: May UPDATE their own option images (alt_text, display_order, etc.)
-- only when the parent question is in draft or pending_approval status.
CREATE POLICY "Teachers can update own option images for draft questions"
  ON question_option_images
  FOR UPDATE
  USING (
    option_id IN (
      SELECT qo.option_id
      FROM question_options qo
      JOIN questions q ON q.question_id = qo.question_id
      WHERE q.created_by = get_my_teacher_id()
        AND q.status IN ('draft', 'pending_approval')
    )
  )
  WITH CHECK (
    option_id IN (
      SELECT qo.option_id
      FROM question_options qo
      JOIN questions q ON q.question_id = qo.question_id
      WHERE q.created_by = get_my_teacher_id()
        AND q.status IN ('draft', 'pending_approval')
    )
  );

-- Admins: May UPDATE any option image within their institute.
CREATE POLICY "Admins can update option images"
  ON question_option_images
  FOR UPDATE
  USING (
    institute_id = get_my_institute_id()
    AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    institute_id = get_my_institute_id()
    AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'
  );

-- ── 5d. DELETE policies ──────────────────────────────────────────────────

-- Teachers: May DELETE their own option images only when the parent question
-- is in draft or pending_approval status. Published questions are immutable.
CREATE POLICY "Teachers can delete own option images for draft questions"
  ON question_option_images
  FOR DELETE
  USING (
    option_id IN (
      SELECT qo.option_id
      FROM question_options qo
      JOIN questions q ON q.question_id = qo.question_id
      WHERE q.created_by = get_my_teacher_id()
        AND q.status IN ('draft', 'pending_approval')
    )
  );

-- Admins: May DELETE any option image within their institute.
CREATE POLICY "Admins can delete option images"
  ON question_option_images
  FOR DELETE
  USING (
    institute_id = get_my_institute_id()
    AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'
  );

-- ═══════════════════════════════════════════════════════════════════════════
--  Migration complete — 023_question_option_images.sql
-- ═══════════════════════════════════════════════════════════════════════════
