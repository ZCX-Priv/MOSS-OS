// scripts/build.mjs
// MOSS 构建脚本：构建后端 (Bun) + 前端 (Vite)
// 使用：node scripts/build.mjs

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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
  // --external nativefiledialog-for-bun：该库通过 Bun.dlopen 加载 FFI 二进制（nfd.dll 等），
  // 二进制路径基于 import.meta.dir 解析，若打包进 server.js 会指向 dist/ 找不到二进制，
  // 故标记为 external，运行时从 node_modules 加载，由库自行解析同目录的 .dll/.dylib/.so。
  run(bun.cmd, [
    ...bun.args,
    'build',
    entry,
    '--outfile', BACKEND_OUT,
    '--target', 'bun',
    '--format', 'esm',
    '--external', 'nativefiledialog-for-bun',
  ]);
  if (!existsSync(BACKEND_OUT)) {
    error(`Backend build output not found: ${BACKEND_OUT}`);
    process.exit(1);
  }
  log(`Backend built: ${BACKEND_OUT}`);
}

// ============================================================================
// 步骤 3: 复制内置工具目录到 dist（供生产模式动态 import + tool.json 读取）
// ============================================================================
function copyBuiltinTools() {
  log('Copying builtin tools...');
  const src = resolve(ROOT, 'src', 'modules', 'tools', 'builtin');
  const dest = resolve(DIST, 'modules', 'tools', 'builtin');
  if (!existsSync(src)) {
    error(`Builtin tools source not found: ${src}`);
    process.exit(1);
  }
  // dist 已在 cleanDist 创建；递归复制保留目录结构（含 tool.json + index.ts）
  // Bun 运行时可直接 import .ts，故复制源码即可
  mkdirSync(resolve(DIST, 'modules', 'tools'), { recursive: true });
  cpSync(src, dest, { recursive: true });
  log(`Builtin tools copied: ${dest}`);
}

// ============================================================================
// 步骤 3b: 复制工具共享模块（builtin 工具通过 ../../shared/search-core 引用）
// ============================================================================
function copySharedModules() {
  log('Copying tools shared modules...');
  const src = resolve(ROOT, 'src', 'modules', 'tools', 'shared');
  const dest = resolve(DIST, 'modules', 'tools', 'shared');
  if (!existsSync(src)) {
    error(`Tools shared modules source not found: ${src}`);
    process.exit(1);
  }
  mkdirSync(resolve(DIST, 'modules', 'tools'), { recursive: true });
  cpSync(src, dest, { recursive: true });
  log(`Tools shared modules copied: ${dest}`);
}

// ============================================================================
// 步骤 3c: 复制 agent/ 提示词目录到 dist（播种源：首次运行复制到 ~/.moss/agent/，
// 运行时只读用户目录，但种子模板必须随包分发）
// ============================================================================
function copyAgentPrompts() {
  log('Copying agent prompts...');
  const src = resolve(ROOT, 'agent');
  const dest = resolve(DIST, 'agent');
  if (!existsSync(src)) {
    error(`Agent prompts source not found: ${src}`);
    process.exit(1);
  }
  cpSync(src, dest, { recursive: true });
  log(`Agent prompts copied: ${dest}`);
}

// ============================================================================
// 步骤 4: 构建前端 (Vite build -> dist/webui/)
// ============================================================================
function buildFrontend() {
  log('Building webui (Vite)...');
  const uiDir = resolve(ROOT, 'webui');
  if (!existsSync(uiDir)) {
    error(`webui directory not found: ${uiDir}`);
    process.exit(1);
  }
  // 在 webui/ 目录运行 npm run build（webui/ 有独立的 vite.config.ts，产物输出到 ../dist/webui）
  run('npm', ['run', 'build'], {
    cwd: uiDir,
    shell: process.platform === 'win32',
  });
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
  console.log(' MOSS Build');
  console.log('=========================================');
  cleanDist();
  buildBackend();
  copyBuiltinTools();
  copySharedModules();
  copyAgentPrompts();
  buildFrontend();
  verifyArtifacts();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log('=========================================');
  console.log(` Build complete in ${elapsed}s`);
  console.log('=========================================');
}

main();
