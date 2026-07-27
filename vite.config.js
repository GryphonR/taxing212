import { defineConfig } from 'vite';

/**
 * Vite configuration for taxing212.
 *
 * - `npm run dev` serves index.html with /src/app/main.js (hot reload).
 * - `npm run build` bundles to Scripts/app.js via scripts/build-app.mjs.
 *
 * Vue must use the full ESM build so in-DOM templates in index.html compile.
 */
export default defineConfig({
  resolve: {
    alias: {
      vue: 'vue/dist/vue.esm.js',
    },
  },
  server: {
    port: 8000,
    open: '/index.html',
  },
  plugins: [
    {
      name: 'taxing212-dev-entry',
      transformIndexHtml(html, ctx) {
        // During dev, load source modules directly instead of the built bundle.
        if (ctx.server) {
          return html.replace(
            'src="Scripts/app.js"',
            'src="/src/app/main.js"',
          );
        }
        return html;
      },
    },
  ],
});
