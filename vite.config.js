import { defineConfig } from 'vite';

/**
 * Vite configuration for taxing212.
 * Phase 1 uses Vite primarily as the Vitest runner host; the live app still
 * loads static assets from the repo root via GitHub Pages.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/lib/run-calculation.js',
      name: 'Taxing212Engine',
      formats: ['es'],
      fileName: 'taxing212-engine',
    },
  },
});
