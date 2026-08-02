// src/plugins/tools/shell.ts
// shell 工具：执行 shell 命令，捕获 stdout/stderr/exitCode。

import { isAbsolute, normalize } from 'node:path';
import type { Tool, ToolResult } from './types';

export const shellTool: Tool = {
  name: 'shell',
  description:
    'Execute a shell command and return stdout, stderr, and exit code. ' +
    'Default timeout is 30 seconds. Use cwd to set the working directory. ' +
    'WARNING: This tool executes arbitrary commands with the user\'s permissions.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (default: agent working directory).',
      },
      timeout: {
        type: 'integer',
        description: 'Timeout in milliseconds (default 30000).',
        minimum: 1000,
        maximum: 600000,
      },
      env: {
        type: 'object',
        description: 'Additional environment variables (merged with process.env).',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    requireConfirmation: true,
  },
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as {
      command: string;
      cwd?: string;
      timeout?: number;
      env?: Record<string, string>;
    };

    if (!p.command || typeof p.command !== 'string') {
      return { content: [{ type: 'text', text: 'Error: command is required' }], isError: true };
    }

    const cwd = p.cwd
      ? isAbsolute(p.cwd) ? normalize(p.cwd) : normalize(resolve(ctx.cwd, p.cwd))
      : ctx.cwd || process.cwd();

    const timeoutMs = p.timeout ?? 30000;

    // Windows 用 cmd.exe /c，POSIX 用 /bin/sh -c
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/c', p.command] : ['-c', p.command];

    const env = { ...process.env, ...p.env };

    ctx.logger.info(`Shell execute: ${p.command}`, { cwd, timeoutMs });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BunAny = Bun as any;
      const proc = BunAny.spawn({
        cmd: [shell, ...shellArgs],
        cwd,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
        windowsHide: true,
      });

      // 等待完成，带超时
      const exitCode = await waitForProcWithTimeout(proc, timeoutMs, ctx);

      // 读取输出
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      let truncated = false;
      let stdoutText = stdout;
      let stderrText = stderr;
      const MAX_OUTPUT = 100_000;
      if (stdoutText.length > MAX_OUTPUT) {
        stdoutText = stdoutText.slice(0, MAX_OUTPUT) + '\n... (truncated)';
        truncated = true;
      }
      if (stderrText.length > MAX_OUTPUT) {
        stderrText = stderrText.slice(0, MAX_OUTPUT) + '\n... (truncated)';
        truncated = true;
      }

      const output =
        `Exit code: ${exitCode}\n` +
        `--- stdout ---\n${stdoutText || '(empty)'}\n` +
        `--- stderr ---\n${stderrText || '(empty)'}`;

      return {
        content: [{ type: 'text', text: output }],
        isError: exitCode !== 0,
        metadata: {
          command: p.command,
          cwd,
          exitCode,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          truncated,
          timedOut: exitCode === -1,
        },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error executing command: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  },
};

async function waitForProcWithTimeout(
  proc: { exited?: Promise<number>; kill?: (signal?: string) => void; pid?: number },
  timeoutMs: number,
  ctx: { signal?: AbortSignal; logger: { warn: (m: string, c?: Record<string, unknown>) => void } },
): Promise<number> {
  const timeoutPromise = new Promise<number>(resolve => {
    const t = setTimeout(() => {
      ctx.logger.warn(`Shell command timed out after ${timeoutMs}ms, killing`);
      try {
        proc.kill?.();
      } catch {
        // 静默
      }
      resolve(-1);
    }, timeoutMs);
    // 若有 abort signal，提前清理
    if (ctx.signal) {
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          try {
            proc.kill?.();
          } catch {
            // 静默
          }
          resolve(-2);
        },
        { once: true },
      );
    }
  });

  const exitPromise = proc.exited ?? new Promise<number>(resolve => resolve(0));
  return Promise.race([exitPromise, timeoutPromise]);
}

function resolve(...paths: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path');
  return path.resolve(...paths);
}
