import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for SyncNote client
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
