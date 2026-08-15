// src/modules/server/static-assets.ts
// 前端静态资源服务：从 dist/webui 读取，SPA fallback。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import type { Environment } from '../../core/types';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export class StaticAssets {
  private readonly root: string;
  private readonly indexHtml: string;
  private readonly exists: boolean;

  constructor(env: Environment) {
    this.root = join(env.packageRoot, 'dist', 'webui');
    this.indexHtml = join(this.root, 'index.html');
    this.exists = existsSync(this.root) && existsSync(this.indexHtml);
  }

  isAvailable(): boolean {
    return this.exists;
  }

  /**
   * 尝试返回静态资源。若路径是 /api 开头或文件不存在返回 null。
   * SPA fallback：未匹配文件时返回 index.html（仅对非资源请求）。
   */
  tryServe(path: string): { status: number; headers: Record<string, string>; body: Buffer | string } | null {
    if (!this.exists) return null;
    if (path.startsWith('/api/') || path.startsWith('/ws')) return null;

    // 防越权：移除 query，规范化
    const cleanPath = normalize(path).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(this.root, cleanPath);

    // 确保解析后仍在 root 内
    if (!filePath.startsWith(this.root)) {
      return { status: 403, headers: {}, body: 'Forbidden' };
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      return this.serveFile(filePath);
    }

    // SPA fallback：对非静态资源请求返回 index.html
    const ext = extname(cleanPath).toLowerCase();
    if (ext === '' || ext === '.html') {
      return this.serveFile(this.indexHtml);
    }
    return null;
  }

  private serveFile(filePath: string): { status: number; headers: Record<string, string>; body: Buffer } {
    const body = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    return {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      },
      body,
    };
  }
}
