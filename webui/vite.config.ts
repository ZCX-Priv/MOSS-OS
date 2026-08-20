import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
// 构建产物输出到项目根目录 dist/webui/，与 src/modules/server/static-assets.ts 对齐
// 后端端口默认 7766，可通过 MOSS_BACKEND_PORT 环境变量覆盖（与 config/config.json 的 server.port 对齐）
const backendPort = process.env.MOSS_BACKEND_PORT ?? '7766';
const backendHttp = `http://127.0.0.1:${backendPort}`;
const backendWs = `ws://127.0.0.1:${backendPort}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA：manifest + service worker（autoUpdate 静默更新）。
    // 预缓存全部静态资源（hashed 文件名长缓存）；/api 与 /ws 永不缓存；
    // dev 模式不启用 SW（避免开发期缓存干扰）
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['MOSS.png'],
      manifest: {
        name: 'MOSS',
        short_name: 'MOSS',
        description: 'MOSS - AI 工作台',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#09090b',
        theme_color: '#18181b',
        icons: [{ src: 'MOSS.png', sizes: '1254x1254', type: 'image/png', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,png,svg,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
      },
      devOptions: { enabled: true },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: backendHttp,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWs,
        ws: true,
      },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/webui'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
})
