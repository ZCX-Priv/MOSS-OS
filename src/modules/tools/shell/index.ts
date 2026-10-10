// tools/shell/index.ts
// shell 工具 execute 逻辑：执行 shell 命令，捕获 stdout/stderr/exitCode。
// filesys 统一化：
//   - cwd 解析走 filesys roots（替代旧版手写 isAbsolute/normalize，统一越权语义）
//   - 执行前后工作区快照检测（beginShellSnapshot/endShellSnapshot）：
//     shell 造成的文件变更（mv/rm/重定向）纳入 file-history（缓存命中可 undo）+ shell-changed 事件
// 元数据见同目录 tool.json。

import { t } from '../../../core/i18n';
import { ServiceNames } from '../../../core/types';
import { statSync } from 'node:fs';
import { decodeShellOutput } from '../../../utils/encoding';
import type { FilesysService, ShellChangeReport } from '../../contracts';
import { SYSTEM_SCOPE, systemRoot } from '../../filesys/roots';
import { probeShells, type ShellId } from '../../context/compiler/env-probe';
import type { ToolContext, ToolResult } from '../types';

/** shell 工具输入参数 */
interface ShellParams {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  /** 指定 shell：实际可用性以 env-probe 实测为准（系统提示中的 Shell 环境段），不可用时回退默认 shell */
  shell?: 'cmd' | 'powershell' | 'bash';
}

/** Bun.spawn 返回的子进程所需字段（显式声明，避免 any，满足 waitForProcWithTimeout 消费） */
interface ManagedSubprocess {
  exited: Promise<number>;
  kill: (signal?: string) => boolean | void;
  pid: number | undefined;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
}

/** shell 选择结果 */
interface ShellConfig {
  bin: string;
  args: string[];
  /** 命令包装器（如 cmd 的 chcp 前置、powershell 的 UTF-8 前置） */
  wrap: (cmd: string) => string;
  /** 面向模型的显示名 */
  label: string;
  /** 请求的 shell 不可用而回退时，回告模型的说明（附在结果尾部） */
  fallbackNote: string | null;
}

/** PowerShell 配置：前置 UTF-8 输出编码设置，避免 UTF-16LE/系统代码页导致乱码 */
function powershellConfig(): ShellConfig {
  return {
    bin: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command'],
    wrap: (c) => `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${c}`,
    label: 'PowerShell',
    fallbackNote: null,
  };
}

/** cmd 配置：前置 chcp 65001 切换 UTF-8 代码页，避免 GBK 输出乱码 */
function cmdConfig(): ShellConfig {
  return {
    bin: 'cmd.exe',
    args: ['/c'],
    wrap: (c) => `chcp 65001 >nul && ${c}`,
    label: 'CMD',
    fallbackNote: null,
  };
}

/** 解析 Git Bash 可执行路径（PATH 中的 bash → 常见安装路径） */
function resolveGitBashBin(): string | null {
  try {
    const hit = Bun.which('bash');
    if (hit) return hit;
  } catch {
    // Bun.which 异常忽略
  }
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // 继续
    }
  }
  return null;
}

/**
 * 根据平台、用户偏好与实测可用性解析 shell 配置（env-probe 单一事实源）。
 * Windows：默认 PowerShell（实测可用时），否则 cmd；bash → Git Bash（实测存在时）；
 * 请求的 shell 不可用时回退默认 shell 并生成 fallbackNote 回告模型（不写死任何 shell 假设）。
 * POSIX：默认 shell 与探测一致（SHELL 声明的 bash/zsh）。
 */
function resolveShell(pref: ShellParams['shell']): ShellConfig {
  const isWindows = process.platform === 'win32';
  const probe = probeShells(isWindows);
  const available = new Set<ShellId>(probe.available);

  if (isWindows) {
    // 默认 shell 与系统提示词 Shell 环境段声明一致（probe.defaultId）
    const defaultCfg: ShellConfig = probe.defaultId === 'powershell'
      ? powershellConfig()
      : cmdConfig();
    if (pref === 'powershell') {
      if (available.has('powershell')) return powershellConfig();
      return {
        ...defaultCfg,
        fallbackNote: `请求的 PowerShell 不可用，实际以 ${defaultCfg.label} 执行；后续命令请按 ${defaultCfg.label} 语法编写`,
      };
    }
    if (pref === 'cmd') {
      if (available.has('cmd')) return cmdConfig();
      return { ...defaultCfg, fallbackNote: `请求的 CMD 不可用，实际以 ${defaultCfg.label} 执行` };
    }
    if (pref === 'bash') {
      const gitBash = available.has('git-bash') ? resolveGitBashBin() : null;
      if (gitBash) {
        return {
          bin: gitBash,
          args: ['-c'],
          wrap: (c) => c,
          label: 'Git Bash',
          fallbackNote: null,
        };
      }
      return {
        ...defaultCfg,
        fallbackNote: `本机没有 Git Bash，实际以 ${defaultCfg.label} 执行；请改用 ${defaultCfg.label} 语法`,
      };
    }
    return defaultCfg;
  }

  // POSIX：默认 shell 与探测一致（SHELL 环境变量声明的 bash/zsh，否则探测结果首个）；
  // cmd/powershell 在 POSIX 上无意义 → 回退默认并回告；显式 bash 即 bash
  const defaultBin = probe.defaultId === 'zsh' ? '/bin/zsh' : '/bin/bash';
  const defaultLabel = probe.defaultId === 'zsh' ? 'Zsh' : 'Bash';
  if (pref === 'cmd' || pref === 'powershell') {
    return {
      bin: defaultBin,
      args: ['-c'],
      wrap: (c) => c,
      label: defaultLabel,
      fallbackNote: `POSIX 环境不支持 ${pref}，实际以 ${defaultLabel} 执行`,
    };
  }
  return {
    bin: defaultBin,
    args: ['-c'],
    wrap: (c) => c,
    label: defaultLabel,
    fallbackNote: null,
  };
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as ShellParams;

    // 输入校验：command 必填且非空白
    if (!p.command || typeof p.command !== 'string' || !p.command.trim()) {
      return { content: [{ type: 'text', text: `Error: ${t('tools.shellCommandRequired')}` }], isError: true };
    }
    // env 值类型校验（必须全部为字符串）
    if (p.env) {
      for (const [k, v] of Object.entries(p.env)) {
        if (typeof v !== 'string') {
          return {
            content: [{ type: 'text', text: `Error: ${t('tools.shellEnvValueType', { key: k, type: typeof v })}` }],
            isError: true,
          };
        }
      }
    }

    // filesys 服务（统一入口；cwd 越权语义与 read/write/edit 一致）
    const filesys = ctx.services.tryResolve<FilesysService>(ServiceNames.FILESYS);
    if (!filesys) {
      return { content: [{ type: 'text', text: `Error: ${t('filesys.serviceUnavailable')}` }], isError: true };
    }

    // cwd 解析：filesys roots 机制（相对路径基于 ctx.cwd；必须在 cwd 或授权 roots 内）
    // System 作用域（本机模式）：未显式指定 cwd 时默认在系统盘根执行
    const cwd = p.cwd
      ? filesys.resolve(p.cwd, ctx.cwd)
      : ctx.cwd === SYSTEM_SCOPE
        ? systemRoot()
        : ctx.cwd || process.cwd();
    if (!cwd) {
      return {
        content: [{ type: 'text', text: `Error: ${t('fs.pathOutsideRoots', { path: p.cwd ?? '', roots: '' })}` }],
        isError: true,
      };
    }

    // cwd 存在性校验：避免 spawn 失败时错误信息不友好
    try {
      const st = statSync(cwd);
      if (!st.isDirectory()) {
        return { content: [{ type: 'text', text: `Error: ${t('tools.shellCwdNotDir', { path: cwd })}` }], isError: true };
      }
    } catch {
      return { content: [{ type: 'text', text: `Error: ${t('tools.shellCwdNotExist', { path: cwd })}` }], isError: true };
    }

    // 优先级：调用参数 > config.tools.shell.timeout > 硬编码 30000；clamp 到 [1000, 600000]
    const rawTimeout = p.timeout ?? (ctx.toolConfig?.timeout as number | undefined) ?? 30000;
    const timeoutMs = Math.max(1000, Math.min(600000, rawTimeout));

    const shellCfg = resolveShell(p.shell);
    const actualCommand = shellCfg.wrap(p.command);

    // 环境变量引导子进程使用 UTF-8 输出
    const env = {
      ...process.env,
      ...p.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    } as Record<string, string>;
    if (process.platform !== 'win32') {
      env.LANG = env.LANG ?? 'zh_CN.UTF-8';
      env.LC_ALL = env.LC_ALL ?? 'zh_CN.UTF-8';
    }

    const startedAt = Date.now();
    ctx.logger.info(t('tools.shellExecute', { command: p.command }), {
      cwd, timeoutMs, shell: shellCfg.bin,
    });

    // 执行前快照：收集工作区 stat 清单（禁用或文件数超限返回 null，静默跳过检测）
    const snap = await filesys.beginShellSnapshot(cwd);

    try {
      const proc = Bun.spawn({
        cmd: [shellCfg.bin, ...shellCfg.args, actualCommand],
        cwd,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
        windowsHide: true,
      }) as unknown as ManagedSubprocess;

      const exitCode = await waitForProcWithTimeout(proc, timeoutMs, ctx);

      // 输出读取：超时/abort 后进程可能已被 kill，读取可能失败或读到不完整数据
      let stdoutText: string;
      let stderrText: string;
      try {
        const stdoutBuf = Buffer.from(await new Response(proc.stdout).arrayBuffer());
        const stderrBuf = Buffer.from(await new Response(proc.stderr).arrayBuffer());
        stdoutText = decodeShellOutput(stdoutBuf);
        stderrText = decodeShellOutput(stderrBuf);
      } catch {
        stdoutText = t('tools.shellOutputUnavailable');
        stderrText = '';
      }

      // 输出截断保护（100K 字符上限防内存爆炸）
      let truncated = false;
      const MAX_OUTPUT = 100_000;
      if (stdoutText.length > MAX_OUTPUT) {
        stdoutText = stdoutText.slice(0, MAX_OUTPUT) + t('tools.shellTruncatedSuffix');
        truncated = true;
      }
      if (stderrText.length > MAX_OUTPUT) {
        stderrText = stderrText.slice(0, MAX_OUTPUT) + t('tools.shellTruncatedSuffix');
        truncated = true;
      }

      const output =
        `${t('tools.shellExitCode', { code: exitCode })}\n` +
        `--- stdout ---\n${stdoutText || t('tools.shellEmpty')}\n` +
        `--- stderr ---\n${stderrText || t('tools.shellEmpty')}` +
        (shellCfg.fallbackNote ? `\n[shell 回告] ${shellCfg.fallbackNote}` : '');

      const durationMs = Date.now() - startedAt;
      ctx.logger.debug(t('tools.shellDone', { exitCode, durationMs }), {
        exitCode, durationMs, truncated,
      });

      // 执行后快照：diff 工作区变更 + 缓存回填备份（可 undo 尽力而为）+ shell-changed 事件
      // 报告摘要拼进工具结果尾部，让模型直接感知自己改了哪些文件（无需额外 read）
      let shellChanges: ShellChangeReport | null = null;
      let workspaceNote = '';
      if (snap) {
        shellChanges = await filesys.endShellSnapshot(snap, ctx.sessionId, ctx.toolCallId);
        if (shellChanges) {
          const count = shellChanges.created.length + shellChanges.modified.length + shellChanges.deleted.length;
          if (count > 0) {
            const brief = (items: string[], label: string): string =>
              items.length === 0 ? '' : `\n  ${label} (${items.length}): ${items.slice(0, 5).join(', ')}${items.length > 5 ? ', ...' : ''}`;
            workspaceNote =
              `\n${t('tools.shellWorkspaceChanges')}` +
              brief(shellChanges.created, t('tools.shellChangeCreated')) +
              brief(shellChanges.modified, t('tools.shellChangeModified')) +
              brief(shellChanges.deleted, t('tools.shellChangeDeleted')) +
              (shellChanges.truncated
                ? t('tools.shellUndoableTruncated', { undone: shellChanges.undone, count })
                : t('tools.shellUndoable', { undone: shellChanges.undone, count }));
          }
        }
      }

      return {
        content: [{ type: 'text', text: output + workspaceNote }],
        isError: exitCode !== 0,
        metadata: {
          command: p.command,
          cwd,
          exitCode,
          stdoutLength: stdoutText.length,
          stderrLength: stderrText.length,
          truncated,
          timedOut: exitCode === -1,
          aborted: exitCode === -2,
          crashed: exitCode === -3,
          shell: shellCfg.bin,
          durationMs,
          ...(shellChanges ? { shellChanges } : {}),
        },
      };
    } catch (err) {
      // spawn 抛错 = 命令未执行，工作区不会变化，无需 end 快照
      return {
        content: [{ type: 'text', text: t('tools.shellExecError', { message: err instanceof Error ? err.message : String(err) }) }],
        isError: true,
      };
    }
  },
};

/**
 * 等待子进程退出，带超时与 abort 中止。
 * 用 settled 标志保证只 resolve 一次，避免 timeout/abort/exit 三者竞态。
 * exitCode 语义：
 *   >=0 正常退出码
 *   -1  超时（kill 后返回）
 *   -2  被 abort 中止（kill 后返回）
 *   -3  子进程 exited Promise reject（异常崩溃，旧实现误报为 0）
 */
async function waitForProcWithTimeout(
  proc: ManagedSubprocess,
  timeoutMs: number,
  ctx: { signal?: AbortSignal; logger: { warn: (m: string, c?: Record<string, unknown>) => void } },
): Promise<number> {
  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
      resolve(code);
    };
    const timer = setTimeout(() => {
      ctx.logger.warn(t('tools.shellTimeout', { timeoutMs }));
      try { proc.kill(); } catch { /* 静默：进程可能已退出 */ }
      finish(-1);
    }, timeoutMs);
    const onAbort = () => {
      try { proc.kill(); } catch { /* 静默 */ }
      finish(-2);
    };
    if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true });
    proc.exited.then((code) => finish(code)).catch(() => finish(-3));
  });
}
