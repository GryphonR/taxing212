import { defineConfig } from 'vite';

/**
 * Vite configuration for taxing212.
 * Builds the Vue UI bundle to Scripts/app.js for GitHub Pages.
 */
export default defineConfig({
  build: {
    outDir: 'Scripts',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/app/main.js',
      output: {
        entryFileNames: 'app.js',
        format: 'es',
      },
    },
  },
});
