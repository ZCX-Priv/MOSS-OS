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
    // dev 模式（devOptions.enabled）提供 manifest + 空壳 SW，支持安装调试。
    // 图标：Chrome/Chromium 安装硬性要求 192x192 与 512x512 PNG（由 MOSS.png 真实缩放生成）
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['MOSS.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'MOSS',
        short_name: 'MOSS',
        description: 'MOSS - AI 工作台',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#09090b',
        theme_color: '#18181b',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,png,svg,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        // 主 chunk 含 @lobehub/icons 品牌图标（约 +0.8MB raw），放宽预缓存上限
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
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
        // 后端重启（--watch）/ 连接被重置时的善后：http-proxy 默认只报错不作为，
        // 浏览器侧 socket 挂死 → 前端要等 30s 心跳超时才发现死链。
        // 主动 end() 客户端侧 → 前端立即 onclose → ~1s 后自动重连
        configure(proxy) {
          const closeClientSide = (resOrSocket: unknown) => {
            const maybe = resOrSocket as { end?: unknown } | null;
            if (maybe && typeof maybe.end === 'function') {
              (maybe.end as () => void)();
            }
          };
          // http-proxy 专用事件：ECONNRESET（后端重启/连接重置）
          proxy.on('econnreset', (_err, _req, resOrSocket) => closeClientSide(resOrSocket));
          // 兜底：其它代理错误（如后端未启动 ECONNREFUSED）同样关闭客户端侧；
          // ECONNRESET 已由上方专用事件处理，跳过避免重复
          proxy.on('error', (err, _req, resOrSocket) => {
            if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
            closeClientSide(resOrSocket);
          });
        },
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
