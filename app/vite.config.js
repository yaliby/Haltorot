import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './vite.plugin.api.js';

/* GitHub Pages serves a project site from a sub-path
   (https://<user>.github.io/Haltorot/), so the build needs to know that
   prefix. The deploy workflow passes it in; a plain local build stays at '/'
   so `npm run preview` keeps working the way it always has. */
const base = process.env.BASE_PATH || '/';

/* Pages has no server to answer a deep link like /library, so it falls back
   to 404.html. Handing it a copy of index.html lets the router take over. */
function pagesFallback() {
  return {
    name: 'halturaz-pages-fallback',
    apply: 'build',
    closeBundle() {
      const dist = new URL('./dist/', import.meta.url);
      copyFileSync(new URL('index.html', dist), new URL('404.html', dist));
    }
  };
}

export default defineConfig({
  base,
  plugins: [react(), apiPlugin(), pagesFallback()],
  server: { host: '0.0.0.0', port: 5174, strictPort: true },
  preview: { host: '0.0.0.0', port: 4174, strictPort: true }
});
