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

const children = [];

function spawnChild(name, cmd, args, opts = {}) {
  log(name, `spawning: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: isWin,
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

  // bun run --watch src/main.ts start --foreground --log-level debug
  return spawnChild('backend', 'bun', [
    'run',
    '--watch',
    entry,
    'start',
    '--foreground',
    '--log-level', 'debug',
  ]);
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
      const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { shell: true });
      const out = r.stdout?.toString() ?? '';
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
  // 在 webui/ 目录运行 npm run dev（webui/ 有独立 vite.config.ts，端口 3000，代理 /api 与 /ws 到后端 7766）
  const child = spawn('npm', ['run', 'dev'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: isWin,
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

function killAll() {
  log('dev', 'shutting down child processes...');
  for (const c of children) {
    try {
      if (isWin) {
        // Windows: taskkill 子进程树
        spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { shell: true });
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

function main() {
  console.log('=========================================');
  console.log(' MOSS Dev');
  console.log('  Backend: http://127.0.0.1:7766');
  console.log('  UI: http://127.0.0.1:3000');
  console.log('=========================================');
  startBackend();
  startFrontend();
  log('dev', 'Press Ctrl+C to stop both.');
}

main();
