import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Minimal Vitest configuration for the bulk-import parser/validator unit
 * tests. Node environment only (pure TS utilities — no React/DOM needed).
 * The `@/` path alias mirrors tsconfig.json.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
