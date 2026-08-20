// src/modules/tools/shared/agent-seed.ts
// agent/ 提示词目录播种 + 内容指纹自动迁移。
// 首次运行：从 <packageRoot>/agent/ 递归复制到 ~/.moss/agent/。
// 已初始化：逐文件内容指纹对比同步——用户未修改的文件自动升级到新版，
// 用户修改过的文件保留不动（内容哈希不匹配任何已知播种指纹）。
// 指纹记录：~/.moss/agent/.seed-manifest.json（path → 上次播种内容 sha256）。
// 失败不阻断启动（静默降级，调用方各自处理目录缺失场景）。

import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Environment } from '../../../core/types';

/** 是否已执行过本次进程内的播种检查（幂等加速；stat 代价低，但避免重复日志/IO） */
let seeded = false;

/**
 * 已知旧版种子内容指纹（relpath → sha256 列表）。
 * 用于 manifest 缺失时的首次迁移：目标内容命中任一旧指纹 = 用户未修改的旧版 → 升级。
 * 后续版本演进由 manifest 机制接管，新迁移时在此追加旧指纹即可。
 */
const LEGACY_SEED_HASHES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'prompts/main/system.md': ['61a92fc6c815da130d26a3f17ebe0d87d954bb897f9eda175b6fd901659d64f0'],
  'prompts/main/rule/rules.md': ['ac01d2b902dc70a0d00c742063b9e306a38363095a8c3873ee306b8aa9d0f924'],
  'prompts/main/base/identity.md': ['a12eb8c73af051a90f1ee09c4b9c5730e255ac10a1fbc697b17872e668af2f0c'],
};

/** manifest 文件名（~/.moss/agent/ 下） */
const MANIFEST_FILE = '.seed-manifest.json';

interface SeedManifest {
  version: 1;
  /** relpath（posix）→ 上次播种内容 sha256 */
  files: Record<string, string>;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 递归枚举目录下所有文件的绝对路径 */
function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      try {
        if (statSync(full).isDirectory()) {
          walk(full);
        } else {
          out.push(full);
        }
      } catch {
        // 单项失败忽略
      }
    }
  };
  walk(root);
  return out;
}

/** 读取 manifest（缺失/损坏返回空 manifest） */
function readManifest(manifestPath: string): SeedManifest {
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<SeedManifest>;
    if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') {
      return { version: 1, files: raw.files as Record<string, string> };
    }
  } catch {
    // 缺失/损坏：视为无记录
  }
  return { version: 1, files: {} };
}

function writeManifest(manifestPath: string, manifest: SeedManifest): void {
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch {
    // 写失败静默：下次启动会重走对比（幂等）
  }
}

/**
 * 播种内置 agent 提示词到 ~/.moss/agent/（带内容指纹自动迁移）。
 * 失败不阻断启动（静默降级，调用方各自处理目录缺失场景）。
 */
export function seedBuiltinAgentPrompts(env: Environment): boolean {
  if (seeded) return true;
  const src = join(env.packageRoot, 'agent');
  const dest = join(env.dataDir, 'agent');
  try {
    if (!existsSync(src)) {
      // 无种子源（异常安装），跳过；调用方回退到各自默认逻辑
      seeded = true;
      return false;
    }
    if (!existsSync(dest)) {
      // 首次初始化：全量复制 + 记录 manifest
      cpSync(src, dest, { recursive: true });
      const files: Record<string, string> = {};
      for (const file of listFilesRecursive(src)) {
        const rel = relative(src, file).split(sep).join('/');
        files[rel] = sha256(readFileSync(file));
      }
      writeManifest(join(dest, MANIFEST_FILE), { version: 1, files });
      seeded = true;
      return true;
    }

    // 已初始化：逐文件内容指纹同步
    const manifestPath = join(dest, MANIFEST_FILE);
    const oldManifest = readManifest(manifestPath);
    const newFiles: Record<string, string> = {};
    for (const file of listFilesRecursive(src)) {
      const rel = relative(src, file).split(sep).join('/');
      const srcHash = sha256(readFileSync(file));
      const target = join(dest, ...rel.split('/'));
      let targetHash: string | null = null;
      try {
        if (existsSync(target)) {
          targetHash = sha256(readFileSync(target));
        }
      } catch {
        targetHash = null;
      }

      if (targetHash === null) {
        // 目标缺失 → 复制
        mkdirSync(join(target, '..'), { recursive: true });
        copyFileSync(file, target);
        newFiles[rel] = srcHash;
        continue;
      }
      if (targetHash === srcHash) {
        // 已最新
        newFiles[rel] = srcHash;
        continue;
      }
      const seededHash = oldManifest.files[rel];
      const legacyHashes = LEGACY_SEED_HASHES[rel];
      if (targetHash === seededHash || (legacyHashes && legacyHashes.includes(targetHash))) {
        // 目标 == 上次播种内容 / 已知旧版种子 → 用户未修改 → 升级为新版
        copyFileSync(file, target);
        newFiles[rel] = srcHash;
        continue;
      }
      // 用户修改过 → 保留不动；manifest 不记该文件播种哈希（下次源再变仍判定为用户版）
    }
    writeManifest(manifestPath, { version: 1, files: newFiles });
    seeded = true;
    return true;
  } catch {
    // 播种失败不阻断，返回 false 让调用方走兜底
    return false;
  }
}
