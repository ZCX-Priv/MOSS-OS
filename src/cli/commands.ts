// src/cli/commands.ts
// CLI 命令路由：start/stop/status/restart/update/version

import { Microkernel } from '../core/kernel';
import { detectEnvironment } from '../core/env';
import {
  readPidFile,
  removePidFile,
  isProcessAlive,
  killProcess,
  writePidFile,
} from '../utils/pid';
import type { LogLevel } from '../core/types';

export interface ParsedArgs {
  command: string;
  foreground: boolean;
  logLevel?: LogLevel;
  /** 额外参数 */
  rest: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // 跳过 node/bun + script
  if (args.length === 0) {
    return { command: 'start', foreground: false, rest: [] };
  }

  let command = 'start';
  const rest: string[] = [];
  let foreground = false;
  let logLevel: LogLevel | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--foreground' || a === '-f') {
      foreground = true;
    } else if (a === '--log-level' || a === '-l') {
      logLevel = args[++i] as LogLevel;
    } else if (!a.startsWith('-')) {
      // 第一个非 flag 参数是命令
      if (command === 'start' && rest.length === 0) {
        command = a;
      } else {
        rest.push(a);
      }
    } else {
      rest.push(a);
    }
  }

  return { command, foreground, logLevel, rest };
}

const VALID_COMMANDS = new Set([
  'start',
  'stop',
  'status',
  'restart',
  'update',
  'version',
  'help',
]);

export async function runCommand(parsed: ParsedArgs): Promise<number> {
  const { command } = parsed;
  if (!VALID_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  switch (command) {
    case 'start':
      return cmdStart(parsed);
    case 'stop':
      return cmdStop();
    case 'status':
      return cmdStatus();
    case 'restart':
      return cmdRestart();
    case 'update':
      return cmdUpdate();
    case 'version':
      return cmdVersion();
    case 'help':
      printHelp();
      return 0;
    default:
      return 1;
  }
}

// ============================================================================
// 各命令实现
// ============================================================================

async function cmdStart(parsed: ParsedArgs): Promise<number> {
  const env = detectEnvironment();

  // 单例检测：若已有进程运行，提示
  const existing = readPidFile(env.pidFile);
  if (existing && isProcessAlive(existing.pid)) {
    console.error(`MOSS-OS is already running (PID ${existing.pid})`);
    console.error(`Use "moss status" to inspect, or "moss restart" to restart.`);
    return 1;
  }
  if (existing) {
    // 残留 PID 文件，清理
    removePidFile(env.pidFile);
  }

  // 前台模式：直接启动内核
  if (parsed.foreground) {
    return startForeground(parsed);
  }

  // 后台守护进程模式：fork 子进程后父进程退出
  return startDaemon();
}

async function startForeground(parsed: ParsedArgs): Promise<number> {
  const env = detectEnvironment();
  const kernel = new Microkernel();
  try {
    await kernel.start({
      foreground: true,
      logLevel: parsed.logLevel,
    });

    // 写 PID 文件
    writePidFile(env.pidFile, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });

    console.log(`MOSS-OS started (PID ${process.pid})`);

    // 注册退出钩子
    const cleanup = async () => {
      await kernel.stop();
      removePidFile(env.pidFile);
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGHUP', cleanup);

    // 保持进程运行
    return new Promise<number>(() => {
      // 永不 resolve，由信号处理退出
    });
  } catch (err) {
    console.error('Failed to start MOSS-OS:', err instanceof Error ? err.message : err);
    await kernel.stop().catch(() => {});
    return 1;
  }
}

async function startDaemon(): Promise<number> {
  const env = detectEnvironment();
  // 用 Bun.spawn detached 模式启动子进程
  // 子进程执行 moss start --foreground
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BunAny = Bun as any;
  const args = [process.argv[1], 'start', '--foreground'];
  const subprocess = BunAny.spawn({
    cmd: [process.execPath, ...args],
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    windowsHide: true,
  });
  // 父进程 unref 后退出
  try {
    subprocess.unref?.();
  } catch {
    // 静默
  }

  // 等待子进程写 PID 文件（最多 5 秒）
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const info = readPidFile(env.pidFile);
    if (info && isProcessAlive(info.pid)) {
      console.log(`MOSS-OS daemon started (PID ${info.pid})`);
      return 0;
    }
    await sleep(200);
  }
  console.error('Daemon started but PID file not detected (process may have failed)');
  return 1;
}

async function cmdStop(): Promise<number> {
  const env = detectEnvironment();
  const info = readPidFile(env.pidFile);
  if (!info) {
    console.log('MOSS-OS is not running (no PID file)');
    return 0;
  }
  if (!isProcessAlive(info.pid)) {
    console.log(`MOSS-OS process (PID ${info.pid}) is not alive, cleaning PID file`);
    removePidFile(env.pidFile);
    return 0;
  }
  console.log(`Stopping MOSS-OS (PID ${info.pid})...`);
  const ok = await killProcess(info.pid, 5000);
  if (ok) {
    removePidFile(env.pidFile);
    console.log('MOSS-OS stopped');
    return 0;
  }
  console.error('Failed to stop MOSS-OS process');
  return 1;
}

async function cmdStatus(): Promise<number> {
  const env = detectEnvironment();
  const info = readPidFile(env.pidFile);
  if (!info) {
    console.log('MOSS-OS: not running (no PID file)');
    return 0;
  }
  const alive = isProcessAlive(info.pid);
  if (!alive) {
    console.log(`MOSS-OS: not running (stale PID file, PID ${info.pid})`);
    return 0;
  }
  console.log(`MOSS-OS: running`);
  console.log(`  PID:        ${info.pid}`);
  console.log(`  Started at: ${info.startedAt}`);
  if (info.port) console.log(`  Port:       ${info.port}`);
  console.log(`  Data dir:   ${env.dataDir}`);
  return 0;
}

async function cmdRestart(): Promise<number> {
  const stopCode = await cmdStop();
  // 即使 stop 失败也尝试 start
  await sleep(500);
  const startCode = await cmdStart({ command: 'start', foreground: false, rest: [] });
  return startCode === 0 ? 0 : startCode;
}

async function cmdUpdate(): Promise<number> {
  console.log('Update check: please use "npm update -g moss-os" to update MOSS-OS');
  return 0;
}

async function cmdVersion(): Promise<number> {
  // 从 package.json 读取版本
  try {
    const env = detectEnvironment();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    const pkgPath = path.join(env.packageRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(`MOSS-OS v${pkg.version}`);
    console.log(`Bun ${env.runtimeVersion}`);
    console.log(`Platform: ${env.platform}/${env.arch}`);
    return 0;
  } catch (err) {
    console.error('Failed to read version:', err);
    return 1;
  }
}

function printHelp(): void {
  console.log(`MOSS-OS - AI Agent Application

Usage: moss <command> [options]

Commands:
  start       Start MOSS-OS as a daemon (default)
  stop        Stop the running daemon
  status      Show running status
  restart     Restart the daemon
  update      Check for updates
  version     Show version info
  help        Show this help

Options:
  --foreground, -f    Run in foreground (no daemon)
  --log-level <level> Set log level (debug/info/warn/error/fatal)

Examples:
  moss start --foreground --log-level debug
  moss status
`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
