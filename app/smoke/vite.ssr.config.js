import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  /* db.js reads its credentials off import.meta.env, and with none the app
     starts empty — which is exactly what these checks render against.
     Pointing envDir at a directory holding no .env files keeps that true even
     once the repo carries .env.production for the published build. */
  envDir: 'smoke',
  build: {
    ssr: 'smoke/entry.jsx',
    outDir: 'smoke/dist',
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/server', 'react-router-dom'] }
  }
});
