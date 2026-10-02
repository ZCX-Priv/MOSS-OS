// src/modules/voice/downloader.ts
// 模型归档下载与解压：流式写盘 + 进度回调 + 系统 tar 解压（bsdtar 支持 bz2）。
// 归档来自 GitHub Releases，体积较大，故使用流式写入避免整包驻留内存。

import { existsSync, mkdirSync, createWriteStream, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { VoiceModelDef } from './types';

/** 解析 tar 可执行文件：Windows 优先 System32 自带的 bsdtar（libarchive，支持 bz2） */
function tarCommand(): string {
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const candidates = [join(sysRoot, 'System32', 'tar.exe')];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return 'tar';
}

/** 流式下载归档到目标文件，返回实际写入字节数 */
async function downloadArchive(
  url: string,
  destFile: string,
  expectedBytes: number,
  onProgress?: (p: number) => void,
): Promise<void> {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok || !resp.body) {
    throw new Error(`下载失败：HTTP ${resp.status}`);
  }
  const headerLen = Number(resp.headers.get('content-length') ?? '0');
  const total = headerLen > 0 ? headerLen : expectedBytes;

  const out = createWriteStream(destFile);
  const reader = resp.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      await new Promise<void>((resolve, reject) => {
        out.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      if (total > 0) onProgress?.(Math.min(1, received / total));
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
  if (received === 0) throw new Error('下载内容为空');
}

/**
 * GitHub Releases 加速镜像前缀：直连大文件在大陆网络常被重置，依次回退到公共代理。
 * 顺序 =「直连 → gh-proxy → ghproxy」，任一成功即使用。
 */
const MIRROR_PREFIXES = ['', 'https://gh-proxy.com/', 'https://ghproxy.net/'];

/** 依次尝试直连与各镜像下载（任一成功即返回） */
async function downloadWithFallback(
  url: string,
  destFile: string,
  expectedBytes: number,
  onProgress?: (p: number) => void,
): Promise<void> {
  let lastError: unknown = null;
  for (const prefix of MIRROR_PREFIXES) {
    try {
      await downloadArchive(`${prefix}${url}`, destFile, expectedBytes, onProgress);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('下载失败（直连与镜像均不可用）');
}

/** 用系统 tar 解压 .tar.bz2 到目标目录 */
function extractTarBz2(archive: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(tarCommand(), ['-xjf', archive, '-C', destDir], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`解压失败（tar 退出码 ${code}）`));
    });
  });
}

/**
 * 下载并解压模型到 modelsRoot/<rootDir>。
 * @param def 模型定义
 * @param modelsRoot 模型根目录（全部模型解压于此）
 * @param onProgress 进度 0..1
 * @returns 解压后的模型目录绝对路径
 */
export async function downloadAndExtract(
  def: VoiceModelDef,
  modelsRoot: string,
  onProgress?: (p: number) => void,
): Promise<string> {
  mkdirSync(modelsRoot, { recursive: true });
  const modelDir = join(modelsRoot, def.rootDir);
  const archivePath = join(modelsRoot, `${def.id}.tar.bz2`);

  try {
    await downloadWithFallback(def.url, archivePath, def.sizeBytes, (p) => onProgress?.(p * 0.9));
    await extractTarBz2(archivePath, modelsRoot);
  } finally {
    // 无论成败都清理归档（体积大）
    try {
      rmSync(archivePath, { force: true });
    } catch {
      // 忽略清理失败
    }
  }

  if (!existsSync(modelDir)) {
    throw new Error(`解压后未找到模型目录：${modelDir}`);
  }
  onProgress?.(1);
  return modelDir;
}