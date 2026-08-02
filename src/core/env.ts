// src/core/env.ts
// 环境检测：平台、架构、路径解析。

import { homedir, platform, arch } from 'node:os';
import { join } from 'node:path';
import type { Environment, Platform } from './types';

/**
 * 探测运行环境并返回标准 Environment 对象。
 * packageRoot 解析策略：
 *  1. 开发模式：从 cwd 向上查找 package.json
 *  2. 安装模式：从 __dirname（编译产物 dist/server.js）向上回退到包根
 */
export function detectEnvironment(): Environment {
  const nodePlatform = platform();
  let p: Platform = 'other';
  if (nodePlatform === 'win32') p = 'win32';
  else if (nodePlatform === 'darwin') p = 'darwin';
  else if (nodePlatform === 'linux') p = 'linux';

  const home = homedir();
  const dataDir = join(home, '.moss-os');
  const configDir = join(dataDir, 'config');
  const logsDir = join(dataDir, 'logs');
  const pidFile = join(dataDir, 'moss.pid');

  const packageRoot = resolvePackageRoot();

  return {
    platform: p,
    arch: arch(),
    isWindows: p === 'win32',
    isMac: p === 'darwin',
    isLinux: p === 'linux',
    homeDir: home,
    dataDir,
    configDir,
    logsDir,
    pidFile,
    runtimeVersion: typeof Bun !== 'undefined' ? Bun.version : 'unknown',
    pid: process.pid,
    packageRoot,
  };
}

function resolvePackageRoot(): string {
  // 优先：从当前文件位置向上查找 package.json
  // 当前文件位于 src/core/env.ts，开发模式下回退 3 层到包根
  // 编译后位于 dist/server.js，回退 1 层到包根
  const candidates = [
    // 编译产物路径
    import.meta.dir,
    // 开发模式：src/core -> 回退 3 层
    join(import.meta.dir, '..', '..', '..'),
    // 编译模式：dist -> 回退 1 层
    join(import.meta.dir, '..'),
    process.cwd(),
  ];

  for (const candidate of candidates) {
    const root = findUpPackageJson(candidate);
    if (root) return root;
  }
  return process.cwd();
}

function findUpPackageJson(start: string): string | null {
  let current = start;
  for (let i = 0; i < 10; i++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs = require('node:fs');
      const path = require('node:path');
      const pkgPath = path.join(current, 'package.json');
      if (fs.existsSync(pkgPath)) {
        // 校验 package name = moss-os，避免误判上级目录
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'moss-os') return current;
      }
    } catch {
      // 继续
    }
    const parent = require('node:path').dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
