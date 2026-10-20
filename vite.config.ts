import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    // Keine data:-URLs (die CSP erlaubt nur Dateien vom eigenen Server)
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:18081',
      '/healthz': 'http://127.0.0.1:18081',
    },
  },
});
