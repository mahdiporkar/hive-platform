import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Served under /console/ by the deployment gateway; talks only to /api/admin/** and /api/me/context on the same origin.
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  build: {outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 2000},
});
