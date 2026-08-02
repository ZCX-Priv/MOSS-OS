import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite 配置：前端构建到 dist/webui/
export default defineConfig({
  root: 'webui',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'webui/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7766',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:7766',
        ws: true,
      },
    },
  },
  build: {
    outDir: resolve(process.cwd(), 'dist/webui'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
});
