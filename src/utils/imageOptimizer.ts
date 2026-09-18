/**
 * Question & Option Image Optimizer Utility
 *
 * Client-side pre-upload image optimization for teacher/admin question authoring.
 * Converts input images (PNG, JPEG, WebP, etc.) to optimized WebP format with
 * proportional downscaling based on the selected profile.
 *
 * Profiles:
 * - `simple_diagram` (Default): Max 1200px edge, quality 0.80 (80%).
 *   Prioritizes fast loading and smaller assets for diagrams, graphs, circuits, geometry, and equations.
 * - `detailed_image`: Max 2048px edge, quality 0.90 (90%).
 *   Prioritizes preserving fine detail and readability for biology anatomy, dense tables, and high-DPI scans.
 *
 * @module utils/imageOptimizer
 */

export type ImageProfile = 'simple_diagram' | 'detailed_image';

export interface ProfileConfig {
  profile: ImageProfile;
  label: string;
  description: string;
  maxEdge: number;
  quality: number;
}

export const IMAGE_PROFILES: Record<ImageProfile, ProfileConfig> = {
  simple_diagram: {
    profile: 'simple_diagram',
    label: 'Simple Diagram — Fast & Light',
    description: 'Best for standard diagrams, circuits, graphs, geometry, and formulas.',
    maxEdge: 1200,
    quality: 0.80,
  },
  detailed_image: {
    profile: 'detailed_image',
    label: 'Detailed Image — High Detail',
    description: 'Best for complex biology/anatomy, dense tables, microscope scans, and detailed figures.',
    maxEdge: 2048,
    quality: 0.90,
  },
};

export interface OptimizedImageResult {
  /** The optimized WebP file ready for upload */
  file: File;
  /** Browser object URL for preview rendering */
  previewUrl: string;
  /** Original file size in bytes */
  originalSizeBytes: number;
  /** Optimized file size in bytes */
  optimizedSizeBytes: number;
  /** Original width in pixels */
  originalWidth: number;
  /** Original height in pixels */
  originalHeight: number;
  /** Optimized width in pixels */
  width: number;
  /** Optimized height in pixels */
  height: number;
  /** MIME type (e.g. 'image/webp') */
  mimeType: string;
  /** The profile used for optimization */
  imageProfile: ImageProfile;
  /** Savings percentage (e.g. 58 for 58% reduction) */
  savingsPercent: number;
}

/**
 * Calculates proportionally scaled dimensions constrained to `maxEdge`
 * while strictly preserving original aspect ratio.
 */
export function calculateDimensions(
  origWidth: number,
  origHeight: number,
  maxEdge: number,
): { width: number; height: number; scale: number } {
  if (origWidth <= 0 || origHeight <= 0) {
    return { width: Math.max(1, origWidth), height: Math.max(1, origHeight), scale: 1 };
  }

  const scale = Math.min(maxEdge / origWidth, maxEdge / origHeight, 1);
  const width = Math.max(1, Math.round(origWidth * scale));
  const height = Math.max(1, Math.round(origHeight * scale));

  return { width, height, scale };
}

/**
 * Formats a byte size into human-readable string (e.g. "38 KB", "2.4 MB").
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(dm))} ${sizes[idx]}`;
}

/**
 * Helper to compute savings percentage.
 */
export function computeSavingsPercent(originalBytes: number, optimizedBytes: number): number {
  if (originalBytes <= 0) return 0;
  const diff = originalBytes - optimizedBytes;
  if (diff <= 0) return 0;
  return Math.round((diff / originalBytes) * 100);
}

/**
 * Replaces or appends the `.webp` extension to a file name.
 */
export function toWebpFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return `${fileName}.webp`;
  return `${fileName.substring(0, lastDot)}.webp`;
}

/**
 * Optimizes an image file on the client side using HTML5 Canvas.
 *
 * @param file - The input image File or Blob
 * @param profile - 'simple_diagram' | 'detailed_image' (defaults to 'simple_diagram')
 * @returns Promise<OptimizedImageResult>
 */
export async function optimizeImage(
  file: File,
  profile: ImageProfile = 'simple_diagram',
): Promise<OptimizedImageResult> {
  const profileConfig = IMAGE_PROFILES[profile] ?? IMAGE_PROFILES.simple_diagram;
  const originalSizeBytes = file.size;
  const originalFileName = file.name || 'image.png';

  // Defensive SSR / non-browser check
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      file,
      previewUrl: '',
      originalSizeBytes,
      optimizedSizeBytes: originalSizeBytes,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
      mimeType: file.type || 'image/png',
      imageProfile: profile,
      savingsPercent: 0,
    };
  }

  return new Promise<OptimizedImageResult>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();

    img.onload = () => {
      try {
        const origWidth = img.naturalWidth || img.width;
        const origHeight = img.naturalHeight || img.height;

        const { width: targetWidth, height: targetHeight } = calculateDimensions(
          origWidth,
          origHeight,
          profileConfig.maxEdge,
        );

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) {
          throw new Error('Failed to obtain 2D canvas context');
        }

        // Use high-quality bicubic/bilinear interpolation
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Clear canvas and draw proportionally scaled image (preserves alpha channel)
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        // Convert to WebP blob
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);

            if (!blob) {
              // Fallback to original file if toBlob returns null
              const fallbackUrl = URL.createObjectURL(file);
              resolve({
                file,
                previewUrl: fallbackUrl,
                originalSizeBytes,
                optimizedSizeBytes: originalSizeBytes,
                originalWidth: origWidth,
                originalHeight: origHeight,
                width: origWidth,
                height: origHeight,
                mimeType: file.type || 'image/png',
                imageProfile: profile,
                savingsPercent: 0,
              });
              return;
            }

            const optimizedFileName = toWebpFileName(originalFileName);
            const optimizedFile = new File([blob], optimizedFileName, {
              type: 'image/webp',
              lastModified: Date.now(),
            });

            const previewUrl = URL.createObjectURL(optimizedFile);
            const optimizedSizeBytes = optimizedFile.size;
            const savingsPercent = computeSavingsPercent(originalSizeBytes, optimizedSizeBytes);

            resolve({
              file: optimizedFile,
              previewUrl,
              originalSizeBytes,
              optimizedSizeBytes,
              originalWidth: origWidth,
              originalHeight: origHeight,
              width: targetWidth,
              height: targetHeight,
              mimeType: 'image/webp',
              imageProfile: profile,
              savingsPercent,
            });
          },
          'image/webp',
          profileConfig.quality,
        );
      } catch {
        URL.revokeObjectURL(objectUrl);
        const fallbackUrl = URL.createObjectURL(file);
        resolve({
          file,
          previewUrl: fallbackUrl,
          originalSizeBytes,
          optimizedSizeBytes: originalSizeBytes,
          originalWidth: 0,
          originalHeight: 0,
          width: 0,
          height: 0,
          mimeType: file.type || 'image/png',
          imageProfile: profile,
          savingsPercent: 0,
        });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const fallbackUrl = URL.createObjectURL(file);
      resolve({
        file,
        previewUrl: fallbackUrl,
        originalSizeBytes,
        optimizedSizeBytes: originalSizeBytes,
        originalWidth: 0,
        originalHeight: 0,
        width: 0,
        height: 0,
        mimeType: file.type || 'image/png',
        imageProfile: profile,
        savingsPercent: 0,
      });
    };

    img.src = objectUrl;
  });
}
