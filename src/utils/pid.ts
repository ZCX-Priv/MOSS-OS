// src/utils/pid.ts
// PID 文件读写：单例锁、跨平台进程管理。

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PidInfo {
  pid: number;
  startedAt: string;
  port?: number;
}

export function writePidFile(pidFile: string, info: PidInfo): void {
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, JSON.stringify(info, null, 2), 'utf8');
}

export function readPidFile(pidFile: string): PidInfo | null {
  if (!existsSync(pidFile)) return null;
  try {
    const text = readFileSync(pidFile, 'utf8');
    return JSON.parse(text) as PidInfo;
  } catch {
    return null;
  }
}

export function removePidFile(pidFile: string): void {
  try {
    if (existsSync(pidFile)) unlinkSync(pidFile);
  } catch {
    // 静默
  }
}

/**
 * 检测指定 PID 的进程是否仍在运行。
 * 跨平台：
 *  - Windows: tasklist /FI "PID eq N"
 *  - Unix: process.kill(pid, 0) 不发信号但检测存在性
 */
export function isProcessAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      // 使用 tasklist 检测
      // 同步执行：Bun.spawnSync
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (Bun as any).spawnSync({
        cmd: ['tasklist', '/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = result.stdout?.toString() ?? '';
      // 若进程不存在，tasklist 输出 "信息: 没有运行的任务匹配指定标准" 或英文 "INFO: No tasks are running..."
      return !/no tasks/i.test(out) && !/没有运行/i.test(out) && String(pid) in toPidSet(out);
    }
    // POSIX
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function toPidSet(csv: string): Record<string, boolean> {
  const set: Record<string, boolean> = {};
  for (const line of csv.split('\n')) {
    const m = line.match(/"?(\d+)"?,/);
    if (m) set[m[1]] = true;
  }
  return set;
}

/**
 * 优雅停止进程：先 SIGTERM，超时后强杀。
 * Windows: taskkill /PID N /T（无 SIGTERM 概念，直接 taskkill）
 */
export async function killProcess(pid: number, timeoutMs = 5000): Promise<boolean> {
  if (!isProcessAlive(pid)) return true;

  try {
    if (process.platform === 'win32') {
      // taskkill /T 杀进程树
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).spawnSync({
        cmd: ['taskkill', '/PID', String(pid), '/T', '/F'],
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } else {
      process.kill(pid, 'SIGTERM');
      // 等待退出
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) return true;
        await sleep(200);
      }
      // 强杀
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // 静默
  }

  await sleep(300);
  return !isProcessAlive(pid);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
