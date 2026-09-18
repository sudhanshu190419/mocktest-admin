-- Migration: Add image_profile, dimensions, size_bytes, and mime_type metadata to question_images and question_option_images
-- Supports dual-profile client-side optimization (Simple Diagram and Detailed Image)

-- 1. Table: question_images
ALTER TABLE public.question_images
  ADD COLUMN IF NOT EXISTS image_profile VARCHAR(20) NOT NULL DEFAULT 'simple_diagram',
  ADD COLUMN IF NOT EXISTS width INTEGER NULL,
  ADD COLUMN IF NOT EXISTS height INTEGER NULL,
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER NULL,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(50) NULL DEFAULT 'image/webp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_question_images_profile'
  ) THEN
    ALTER TABLE public.question_images
      ADD CONSTRAINT ck_question_images_profile
      CHECK (image_profile IN ('simple_diagram', 'detailed_image'));
  END IF;
END $$;

COMMENT ON COLUMN public.question_images.image_profile IS 'Optimization profile: simple_diagram (default, 1200px max, q=0.90) or detailed_image (2048px max, q=0.85)';
COMMENT ON COLUMN public.question_images.width IS 'Image pixel width after client-side optimization';
COMMENT ON COLUMN public.question_images.height IS 'Image pixel height after client-side optimization';
COMMENT ON COLUMN public.question_images.size_bytes IS 'Actual file size in bytes';
COMMENT ON COLUMN public.question_images.mime_type IS 'MIME type of stored asset (e.g. image/webp)';

-- 2. Table: question_option_images
ALTER TABLE public.question_option_images
  ADD COLUMN IF NOT EXISTS image_profile VARCHAR(20) NOT NULL DEFAULT 'simple_diagram',
  ADD COLUMN IF NOT EXISTS width INTEGER NULL,
  ADD COLUMN IF NOT EXISTS height INTEGER NULL,
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER NULL,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(50) NULL DEFAULT 'image/webp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_question_option_images_profile'
  ) THEN
    ALTER TABLE public.question_option_images
      ADD CONSTRAINT ck_question_option_images_profile
      CHECK (image_profile IN ('simple_diagram', 'detailed_image'));
  END IF;
END $$;

COMMENT ON COLUMN public.question_option_images.image_profile IS 'Optimization profile: simple_diagram (default, 1200px max, q=0.90) or detailed_image (2048px max, q=0.85)';
COMMENT ON COLUMN public.question_option_images.width IS 'Image pixel width after client-side optimization';
COMMENT ON COLUMN public.question_option_images.height IS 'Image pixel height after client-side optimization';
COMMENT ON COLUMN public.question_option_images.size_bytes IS 'Actual file size in bytes';
COMMENT ON COLUMN public.question_option_images.mime_type IS 'MIME type of stored asset (e.g. image/webp)';
