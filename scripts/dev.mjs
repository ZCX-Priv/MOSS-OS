// scripts/dev.mjs
// MOSS 开发脚本：并行启动后端 (Bun watch) + 前端 (Vite dev)
// 使用：node scripts/dev.mjs
//
// - 后端：bun run --watch src/main.ts start --foreground --log-level debug
//   （文件改动自动重启）
// - 前端：vite（5173 端口，代理 /api 与 /ws 到后端 7766）
//
// Ctrl+C 优雅退出，关闭所有子进程。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const isWin = process.platform === 'win32';

// 后端端口：镜像 config/config.json 的 server.port（autoPort=false）。
// dev 横幅与 vite.config.ts 代理目标均以此为准。
const BACKEND_PORT = 7766;

function log(tag, msg) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] [${tag}] ${msg}`);
}

function hasBun() {
  const r = spawnSync('bun', ['--version'], { shell: isWin });
  return r.status === 0;
}

function hasNpx() {
  const r = spawnSync('npx', ['--version'], { shell: isWin });
  return r.status === 0;
}

/**
 * 解析 bun 的真实 .exe 路径（Windows 专用）。
 * Windows 上 spawn('bun',...) 无 shell 时 CreateProcess 不查找 .cmd，
 * 若 bun 是 npm 全局安装的 bun.cmd 会 ENOENT。
 * 此函数用 where.exe 找到 bun.exe 真实路径，直接 spawn 绕开 cmd.exe 批处理中间层。
 * 非 Windows 或找不到时回退 'bun'。
 */
function resolveBunExe() {
  if (!isWin) return 'bun';
  try {
    const r = spawnSync('where', ['bun'], { encoding: 'utf8' });
    if (r.status === 0) {
      const lines = r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
      // 优先选 .exe（Bun 官方安装器或其他 PATH 中的 bun.exe）
      const exe = lines.find(l => l.toLowerCase().endsWith('.exe'));
      if (exe) return exe;
      // 只有 .cmd（npm 全局安装）：从 npm shim 推断 bun.exe 真实路径。
      // 检查多个候选，覆盖不同 bun 包结构。
      const cmd = lines.find(l => l.toLowerCase().endsWith('.cmd'));
      if (cmd) {
        const base = dirname(cmd);
        const candidates = [
          resolve(base, 'node_modules', 'bun', 'bin', 'bun.exe'),
          resolve(base, 'node_modules', 'bun', 'bun.exe'),
          resolve(base, '.bun', 'bin', 'bun.exe'),
        ];
        for (const c of candidates) {
          if (existsSync(c)) return c;
        }
        // 最后兜底：解析 bun.cmd 内容里的真实路径（npm shim 固定含二进制路径）
        const shim = spawnSync('node', ['-e',
          `const fs=require('fs');const p=process.argv[1];const s=fs.readFileSync(p,'utf8');const m=s.match(/~dp0\\\\[^\"]+bun\.exe/i);if(m)console.log(m[0].replace('~dp0',''))`,
          cmd], { encoding: 'utf8' });
        if (shim.status === 0 && shim.stdout.trim()) {
          const p = resolve(dirname(cmd), shim.stdout.trim().replace(/^[\\/]+/, ''));
          if (existsSync(p)) return p;
        }
      }
    }
  } catch {
    // where.exe 不可用，回退
  }
  return 'bun';
}

const children = [];

function spawnChild(name, cmd, args, opts = {}) {
  log(name, `spawning: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: ROOT,
    ...opts,
  });
  child.on('exit', (code, signal) => {
    log(name, `exited (code=${code}, signal=${signal})`);
  });
  child.on('error', err => {
    log(name, `error: ${err.message}`);
  });
  children.push(child);
  return child;
}

function startBackend() {
  log('backend', 'starting (bun --watch)...');
  if (!hasBun()) {
    log('backend', 'ERROR: bun not found. Install Bun >= 1.1.0 first.');
    process.exit(1);
  }
  const entry = resolve(ROOT, 'src/main.ts');
  if (!existsSync(entry)) {
    log('backend', `ERROR: entry not found: ${entry}`);
    process.exit(1);
  }

  // 预检残留 PID：若 ~/.moss/moss.pid 记录的进程仍存活，
  // foreground 后端会因单例检测直接退出，提前提示用户清理。
  checkStalePid();

  const args = ['run', '--watch', entry, 'start', '--foreground', '--log-level', 'debug'];

  // 解析 bun.exe 真实路径，直接 spawn（无 shell 无 cmd.exe）。
  // 绕开 bun.cmd 批处理中间层——Windows 控制台 Ctrl+C 时执行批处理的 cmd.exe 会弹
  // "终止批处理操作吗(Y/N)?"，直接 spawn bun.exe 可彻底消除该弹窗。
  const bunExe = resolveBunExe();
  log('backend', `using bun: ${bunExe}`);
  const child = spawnChild('backend', bunExe, args);
  child.once('error', err => {
    if (err.code === 'ENOENT') {
      log('backend', `${bunExe} not found, retrying with shell...`);
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      spawnChild('backend', 'bun', args, { shell: isWin });
    }
  });
  return child;
}

/**
 * 预检残留 PID 文件：若 ~/.moss/moss.pid 记录的进程仍存活，
 * 后端 foreground 模式会因单例检测直接退出。提前打印警告，避免用户面对 ECONNREFUSED 不知所措。
 * 不自动杀进程（避免误杀用户故意保留的 daemon）。
 */
function checkStalePid() {
  const pidFile = resolve(homedir(), '.moss', 'moss.pid');
  if (!existsSync(pidFile)) return;
  let info;
  try {
    info = JSON.parse(readFileSync(pidFile, 'utf8'));
  } catch {
    return;
  }
  if (!info || typeof info.pid !== 'number') return;
  if (isPidAlive(info.pid)) {
    log('backend', `WARNING: live MOSS process detected (PID ${info.pid}) from ${pidFile}.`);
    log('backend', `  The foreground backend will exit due to single-instance check.`);
    log('backend', `  Run "moss stop" or kill PID ${info.pid} first, then restart dev.`);
  } else {
    log('backend', `NOTE: stale PID file at ${pidFile} (PID ${info.pid} not alive); will be auto-cleaned on start.`);
  }
}

function isPidAlive(pid) {
  try {
    if (isWin) {
      const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
      const out = r.stdout ?? '';
      return !/no tasks/i.test(out) && !/没有运行/i.test(out) && String(pid) in toPidSet(out);
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function toPidSet(csv) {
  const set = {};
  for (const line of csv.split('\n')) {
    const m = line.match(/"?(\d+)"?,/);
    if (m) set[m[1]] = true;
  }
  return set;
}

function startFrontend() {
  log('ui', 'starting (vite in webui/)...');
  const uiDir = resolve(ROOT, 'webui');
  if (!existsSync(uiDir)) {
    log('ui', `ERROR: webui directory not found: ${uiDir}`);
    process.exit(1);
  }
  // 直接用 Node 运行 vite 的 JS 入口，绕开 Windows 上的 npm.cmd / vite.cmd 批处理。
  // 批处理在 Ctrl+C 时会弹 "终止批处理操作吗(Y/N)?"，导致退出体验恶劣。
  // 等价于 webui/package.json 的 "dev": "vite"，会读取同一 vite.config.ts（端口 3000 + 代理）。
  const viteJs = resolve(uiDir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteJs)) {
    log('ui', `ERROR: vite not installed. Run "cd webui && npm install" first.`);
    log('ui', `  (expected: ${viteJs})`);
    process.exit(1);
  }
  log('ui', `using node: ${process.execPath}`);
  const child = spawn(process.execPath, [viteJs], {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: uiDir,
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  child.on('exit', (code, signal) => {
    log('ui', `exited (code=${code}, signal=${signal})`);
  });
  child.on('error', err => {
    log('ui', `error: ${err.message}`);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function killAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('dev', 'shutting down child processes...');
  for (const c of children) {
    try {
      if (isWin) {
        // Windows: taskkill 子进程树
        spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F']);
      } else {
        c.kill('SIGTERM');
      }
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on('SIGINT', killAll);
process.on('SIGTERM', killAll);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 健康门控：轮询后端 /api/health 直到返回 200 或超时。
 * 解决启动竞态——Vite 秒级就绪而 Bun 后端加载模组较慢，
 * 若前端先起，浏览器 WS 客户端会在后端就绪前连 /ws，触发 ECONNRESET。
 * 后端 health 路由在 Bun.serve 绑定端口前注册，能响应即代表 HTTP+WS 均就绪。
 */
async function waitForBackend(port, timeoutMs = 20000) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch {
      // 后端尚未就绪（ECONNREFUSED / 中断 / 超时），继续轮询
    }
    await sleep(250);
  }
  return false;
}

async function main() {
  console.log('=========================================');
  console.log(' MOSS Dev');
  console.log(`  Backend: http://127.0.0.1:${BACKEND_PORT}`);
  console.log(' UI: http://127.0.0.1:3000');
  console.log(' Tip: 使用 "node scripts/dev.mjs" 启动可避免 npm 在 Windows 的批处理弹窗');
  console.log('=========================================');
  startBackend();
  log('dev', 'Waiting for backend to be ready...');
  const ready = await waitForBackend(BACKEND_PORT, 20000);
  if (ready) {
    log('backend', `ready (health 200 on :${BACKEND_PORT})`);
  } else {
    log('backend', `WARNING: not ready after 20s, starting frontend anyway (WS proxy may error until backend is up)`);
  }
  startFrontend();
  log('dev', 'Press Ctrl+C to stop both.');
}

main();
