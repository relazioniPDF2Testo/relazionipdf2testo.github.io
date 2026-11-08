import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
});
