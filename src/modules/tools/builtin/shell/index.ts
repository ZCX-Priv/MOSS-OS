// builtin/shell/index.ts
// shell 工具 execute 逻辑：执行 shell 命令，捕获 stdout/stderr/exitCode。
// 元数据见同目录 tool.json。

import { t } from '../../../../core/i18n';
import { isAbsolute, normalize, resolve } from 'node:path';
import { decodeShellOutput } from '../../../../utils/encoding';
import type { ToolContext, ToolResult } from '../../types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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

    // 优先级：调用参数 > config.tools.shell.timeout > 硬编码 30000
    const timeoutMs = p.timeout ?? (ctx.toolConfig?.timeout as number | undefined) ?? 30000;

    // Windows 用 cmd.exe /c（前置 chcp 65001 切换 UTF-8 代码页，避免 GBK 输出乱码），
    // POSIX 用 /bin/sh -c
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const actualCommand = isWindows
      ? `chcp 65001 >nul && ${p.command}`
      : p.command;
    const shellArgs = isWindows ? ['/c', actualCommand] : ['-c', p.command];

    // 环境变量引导子进程使用 UTF-8 输出
    const env = {
      ...process.env,
      ...p.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    } as Record<string, string>;
    if (!isWindows) {
      env.LANG = env.LANG ?? 'zh_CN.UTF-8';
      env.LC_ALL = env.LC_ALL ?? 'zh_CN.UTF-8';
    }

    ctx.logger.info(t('tools.shellExecute', { command: p.command }), { cwd, timeoutMs });

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

      const exitCode = await waitForProcWithTimeout(proc, timeoutMs, ctx);

      const stdoutBuf = Buffer.from(await new Response(proc.stdout).arrayBuffer());
      const stderrBuf = Buffer.from(await new Response(proc.stderr).arrayBuffer());
      const stdout = decodeShellOutput(stdoutBuf);
      const stderr = decodeShellOutput(stderrBuf);

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
    const timer = setTimeout(() => {
      ctx.logger.warn(t('tools.shellTimeout', { timeoutMs }));
      try {
        proc.kill?.();
      } catch {
        // 静默
      }
      resolve(-1);
    }, timeoutMs);
    if (ctx.signal) {
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
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
