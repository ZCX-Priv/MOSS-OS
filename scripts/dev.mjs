// scripts/dev.mjs
// MOSS-OS 开发脚本：并行启动后端 (Bun watch) + 前端 (Vite dev)
// 使用：node scripts/dev.mjs
//
// - 后端：bun run --watch src/main.ts start --foreground --log-level debug
//   （文件改动自动重启）
// - 前端：vite（5173 端口，代理 /api 与 /ws 到后端 7766）
//
// Ctrl+C 优雅退出，关闭所有子进程。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

function startFrontend() {
  log('frontend', 'starting (vite)...');
  const viteBin = resolve(ROOT, 'node_modules/vite/bin/vite.js');
  if (existsSync(viteBin)) {
    return spawnChild('frontend', 'node', [viteBin], {
      env: { ...process.env, FORCE_COLOR: '1' },
    });
  }
  if (hasNpx()) {
    return spawnChild('frontend', 'npx', ['vite'], {
      env: { ...process.env, FORCE_COLOR: '1' },
    });
  }
  log('frontend', 'ERROR: vite not found. Run "npm install" first.');
  process.exit(1);
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
  console.log(' MOSS-OS Dev');
  console.log('  Backend: http://127.0.0.1:7766');
  console.log('  Frontend: http://127.0.0.1:5173');
  console.log('=========================================');
  startBackend();
  startFrontend();
  log('dev', 'Press Ctrl+C to stop both.');
}

main();
