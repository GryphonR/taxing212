/**
 * Post-build step: bundle the Vite app entry into Scripts/app.js for static hosting
 * while index.html uses /src/app/main.js for local Vite dev.
 */
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  configFile: resolve(rootDir, 'vite.config.js'),
  build: {
    outDir: resolve(rootDir, 'Scripts'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(rootDir, 'src/app/main.js'),
      output: {
        entryFileNames: 'app.js',
        format: 'es',
      },
    },
  },
});
