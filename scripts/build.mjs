// scripts/build.mjs
// MOSS-OS 构建脚本：构建后端 (Bun) + 前端 (Vite)
// 使用：node scripts/build.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const DIST = resolve(ROOT, 'dist');
const WEBUI_DIST = resolve(DIST, 'webui');
const BACKEND_OUT = resolve(DIST, 'server.js');

function log(msg) {
  console.log(`[build] ${msg}`);
}

function error(msg) {
  console.error(`[build] ERROR: ${msg}`);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: ROOT,
    ...opts,
  });
  if (result.status !== 0) {
    error(`Command failed: ${cmd} ${args.join(' ')} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function detectBun() {
  // 优先使用直接可用的 bun 命令
  const r = spawnSync('bun', ['--version'], { shell: process.platform === 'win32' });
  if (r.status === 0) return { cmd: 'bun', args: [] };
  // 回退到 npx bun（兼容 bun 以 npm 包形式全局安装但不在 PATH 的场景）
  const r2 = spawnSync('npx', ['bun', '--version'], { shell: process.platform === 'win32' });
  if (r2.status === 0) return { cmd: 'npx', args: ['bun'] };
  return null;
}

function detectNpx() {
  const r = spawnSync('npx', ['--version'], { shell: process.platform === 'win32' });
  if (r.status === 0) return 'npx';
  return null;
}

// ============================================================================
// 步骤 1: 清理 dist
// ============================================================================
function cleanDist() {
  log('Cleaning dist/');
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true, force: true });
  }
  mkdirSync(DIST, { recursive: true });
}

// ============================================================================
// 步骤 2: 构建后端 (Bun build -> dist/server.js)
// ============================================================================
function buildBackend() {
  log('Building backend (Bun)...');
  const bun = detectBun();
  if (!bun) {
    error('bun not found. Please install Bun >= 1.1.0 first.');
    process.exit(1);
  }
  const entry = resolve(ROOT, 'src/main.ts');
  if (!existsSync(entry)) {
    error(`Backend entry not found: ${entry}`);
    process.exit(1);
  }
  // bun build src/main.ts --outfile dist/server.js --target bun
  run(bun.cmd, [
    ...bun.args,
    'build',
    entry,
    '--outfile', BACKEND_OUT,
    '--target', 'bun',
    '--format', 'esm',
  ]);
  if (!existsSync(BACKEND_OUT)) {
    error(`Backend build output not found: ${BACKEND_OUT}`);
    process.exit(1);
  }
  log(`Backend built: ${BACKEND_OUT}`);
}

// ============================================================================
// 步骤 3: 构建前端 (Vite build -> dist/webui/)
// ============================================================================
function buildFrontend() {
  log('Building webui (Vite)...');
  const webuiDir = resolve(ROOT, 'webui');
  if (!existsSync(webuiDir)) {
    error(`WebUI directory not found: ${webuiDir}`);
    process.exit(1);
  }
  // 优先 npx vite build（兼容环境），否则 fallback 到 node node_modules/vite/bin/vite.js
  const npx = detectNpx();
  if (npx) {
    run(npx, ['vite', 'build'], { cwd: ROOT });
  } else {
    const viteBin = resolve(ROOT, 'node_modules/vite/bin/vite.js');
    if (!existsSync(viteBin)) {
      error('vite not found. Run "npm install" first.');
      process.exit(1);
    }
    run('node', [viteBin, 'build'], { cwd: ROOT });
  }
  if (!existsSync(WEBUI_DIST)) {
    error(`WebUI build output not found: ${WEBUI_DIST}`);
    process.exit(1);
  }
  log(`WebUI built: ${WEBUI_DIST}`);
}

// ============================================================================
// 步骤 4: 校验关键产物
// ============================================================================
function verifyArtifacts() {
  log('Verifying artifacts...');
  const required = [
    BACKEND_OUT,
    WEBUI_DIST,
    resolve(WEBUI_DIST, 'index.html'),
  ];
  for (const p of required) {
    if (!existsSync(p)) {
      error(`Missing artifact: ${p}`);
      process.exit(1);
    }
  }
  log('All artifacts present.');
}

// ============================================================================
// 主流程
// ============================================================================
function main() {
  const startedAt = Date.now();
  console.log('=========================================');
  console.log(' MOSS-OS Build');
  console.log('=========================================');
  cleanDist();
  buildBackend();
  buildFrontend();
  verifyArtifacts();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log('=========================================');
  console.log(` Build complete in ${elapsed}s`);
  console.log('=========================================');
}

main();
