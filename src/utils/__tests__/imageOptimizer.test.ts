import { describe, it, expect } from 'vitest';
import {
  calculateDimensions,
  formatBytes,
  computeSavingsPercent,
  toWebpFileName,
  IMAGE_PROFILES,
} from '../imageOptimizer';

describe('imageOptimizer unit tests', () => {
  describe('Profile Configurations', () => {
    it('has simple_diagram with 1200px maxEdge and quality 0.80', () => {
      expect(IMAGE_PROFILES.simple_diagram).toBeDefined();
      expect(IMAGE_PROFILES.simple_diagram.maxEdge).toBe(1200);
      expect(IMAGE_PROFILES.simple_diagram.quality).toBe(0.80);
      expect(IMAGE_PROFILES.simple_diagram.label).toBe('Simple Diagram — Fast & Light');
    });

    it('has detailed_image with 2048px maxEdge and quality 0.90', () => {
      expect(IMAGE_PROFILES.detailed_image).toBeDefined();
      expect(IMAGE_PROFILES.detailed_image.maxEdge).toBe(2048);
      expect(IMAGE_PROFILES.detailed_image.quality).toBe(0.90);
      expect(IMAGE_PROFILES.detailed_image.label).toBe('Detailed Image — High Detail');
    });

    it('ensures detailed_image quality is strictly greater than simple_diagram quality', () => {
      expect(IMAGE_PROFILES.detailed_image.quality).toBeGreaterThan(IMAGE_PROFILES.simple_diagram.quality);
      expect(IMAGE_PROFILES.detailed_image.maxEdge).toBeGreaterThan(IMAGE_PROFILES.simple_diagram.maxEdge);
    });
  });

  describe('calculateDimensions', () => {
    it('scales down a 2400x1600 landscape image to 1200x800 for simple_diagram', () => {
      const result = calculateDimensions(2400, 1600, 1200);
      expect(result.width).toBe(1200);
      expect(result.height).toBe(800);
      expect(result.scale).toBe(0.5);
    });

    it('scales down a 1600x3200 portrait image to 600x1200 for simple_diagram', () => {
      const result = calculateDimensions(1600, 3200, 1200);
      expect(result.width).toBe(600);
      expect(result.height).toBe(1200);
      expect(result.scale).toBe(0.375);
    });

    it('does not upscale an 800x600 image that is smaller than 1200px', () => {
      const result = calculateDimensions(800, 600, 1200);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.scale).toBe(1);
    });

    it('scales down a 4000x3000 high-res scan to 2048x1536 for detailed_image', () => {
      const result = calculateDimensions(4000, 3000, 2048);
      expect(result.width).toBe(2048);
      expect(result.height).toBe(1536);
      expect(result.scale).toBe(0.512);
    });

    it('scales down a square 3000x3000 diagram to 1200x1200', () => {
      const result = calculateDimensions(3000, 3000, 1200);
      expect(result.width).toBe(1200);
      expect(result.height).toBe(1200);
      expect(result.scale).toBe(0.4);
    });

    it('handles zero or negative dimensions safely', () => {
      const result = calculateDimensions(0, 0, 1200);
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.scale).toBe(1);
    });
  });

  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes < 1 KB', () => {
      expect(formatBytes(512)).toBe('512 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(51200)).toBe('50 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(2500000)).toBe('2.4 MB');
      expect(formatBytes(10485760)).toBe('10 MB');
    });
  });

  describe('computeSavingsPercent', () => {
    it('computes 90% savings when 500KB compresses to 50KB', () => {
      expect(computeSavingsPercent(500000, 50000)).toBe(90);
    });

    it('computes 95% savings when 1MB compresses to 50KB', () => {
      expect(computeSavingsPercent(1000000, 50000)).toBe(95);
    });

    it('returns 0 when optimized size is greater than or equal to original', () => {
      expect(computeSavingsPercent(50000, 60000)).toBe(0);
      expect(computeSavingsPercent(50000, 50000)).toBe(0);
    });

    it('returns 0 for zero original bytes', () => {
      expect(computeSavingsPercent(0, 50000)).toBe(0);
    });
  });

  describe('toWebpFileName', () => {
    it('converts png extension to webp', () => {
      expect(toWebpFileName('circuit_diagram.png')).toBe('circuit_diagram.webp');
    });

    it('converts jpeg and jpg extensions to webp', () => {
      expect(toWebpFileName('histology_scan.jpeg')).toBe('histology_scan.webp');
      expect(toWebpFileName('formula.jpg')).toBe('formula.webp');
    });

    it('appends .webp if no extension is present', () => {
      expect(toWebpFileName('diagram_file')).toBe('diagram_file.webp');
    });
  });
});
