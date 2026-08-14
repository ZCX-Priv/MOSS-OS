// src/modules/tools/builtin/shell/index.test.ts
// shell 工具单元测试：覆盖正常路径、非零退出、超时、边界校验、跨平台 shell 选择。
// 使用 bun:test 运行器。跨平台命令测试根据 process.platform 调整。

import { describe, it, expect } from 'bun:test';
import shellTool from './index';
import type { ToolContext, ToolResult } from '../../types';

/** 构造 mock ToolContext */
function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionId: 'test-session',
    cwd: process.cwd(),
    toolCallId: 'tc-test',
    emit: () => {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    services: { tryResolve: () => null } as unknown as ToolContext['services'],
    ...overrides,
  } as unknown as ToolContext;
}

const isWindows = process.platform === 'win32';

describe('shell 工具 - 输入校验', () => {
  it('空 command 返回错误', async () => {
    const result = await shellTool.execute({ command: '' }, makeCtx());
    expect(result.isError).toBe(true);
    expect(result.content[0].type === 'text' && result.content[0].text).toContain('command is required');
  });

  it('仅空白字符 command 返回错误', async () => {
    const result = await shellTool.execute({ command: '   ' }, makeCtx());
    expect(result.isError).toBe(true);
    expect(result.content[0].type === 'text' && result.content[0].text).toContain('command is required');
  });

  it('command 非字符串返回错误', async () => {
    const result = await shellTool.execute({ command: 123 }, makeCtx());
    expect(result.isError).toBe(true);
  });

  it('env 值非字符串返回错误', async () => {
    const result = await shellTool.execute(
      { command: 'echo hi', env: { FOO: 123 as unknown as string } },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].type === 'text' && result.content[0].text).toContain('env value for "FOO"');
  });
});

describe('shell 工具 - cwd 校验', () => {
  it('cwd 不存在返回错误', async () => {
    const result = await shellTool.execute(
      { command: 'echo hi', cwd: '/nonexistent/path/that/should/not/exist' },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].type === 'text' && result.content[0].text).toContain('cwd does not exist');
  });
});

describe('shell 工具 - 正常执行', () => {
  it('echo 命令返回 exitCode 0 且 stdout 含输出', async () => {
    const result = await shellTool.execute({ command: 'echo shell_test_output' }, makeCtx());
    expect(result.isError).toBe(false);
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Exit code: 0');
    expect(text).toContain('shell_test_output');
  });

  it('metadata 含 shell 字段', async () => {
    const result = await shellTool.execute({ command: 'echo hi' }, makeCtx());
    const meta = result.metadata as Record<string, unknown> | undefined;
    expect(meta).toBeDefined();
    expect(meta).toHaveProperty('shell');
    expect(meta).toHaveProperty('durationMs');
    expect(meta).toHaveProperty('exitCode');
  });
});

describe('shell 工具 - 非零退出', () => {
  it('exit 非零返回 isError true', async () => {
    // Windows cmd: exit /b 1；POSIX sh: exit 1
    const cmd = isWindows ? 'exit /b 1' : 'exit 1';
    const result = await shellTool.execute({ command: cmd }, makeCtx());
    expect(result.isError).toBe(true);
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Exit code: 1');
  });
});

describe('shell 工具 - 超时', () => {
  it('超时返回 exitCode -1 且 timedOut true', async () => {
    // sleep 命令：Windows 无原生 sleep，用 ping 模拟；POSIX 用 sleep
    const cmd = isWindows ? 'ping -n 10 127.0.0.1 >nul' : 'sleep 10';
    const result = await shellTool.execute(
      { command: cmd, timeout: 1000 },
      makeCtx(),
    );
    const meta = result.metadata as Record<string, unknown> | undefined;
    expect(meta?.timedOut).toBe(true);
    expect(meta?.exitCode).toBe(-1);
  });
});

describe('shell 工具 - shell 选择', () => {
  it('Windows 默认使用 cmd.exe', async () => {
    if (!isWindows) return; // 非 Windows 跳过
    const result = await shellTool.execute({ command: 'echo hi' }, makeCtx());
    const meta = result.metadata as Record<string, unknown> | undefined;
    expect(meta?.shell).toBe('cmd.exe');
  });

  it('Windows 可选 powershell', async () => {
    if (!isWindows) return; // 非 Windows 跳过
    const result = await shellTool.execute(
      { command: 'Write-Output ps_test', shell: 'powershell' },
      makeCtx(),
    );
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    const meta = result.metadata as Record<string, unknown> | undefined;
    expect(meta?.shell).toBe('powershell.exe');
    expect(text).toContain('ps_test');
  });

  it('POSIX 默认使用 /bin/sh 或 /bin/bash', async () => {
    if (isWindows) return; // Windows 跳过
    const result = await shellTool.execute({ command: 'echo hi' }, makeCtx());
    const meta = result.metadata as Record<string, unknown> | undefined;
    expect(meta?.shell).toMatch(/\/bin\/(sh|bash)/);
  });

  it('POSIX 指定 bash', async () => {
    if (isWindows) return;
    const result = await shellTool.execute(
      { command: 'echo hi', shell: 'bash' },
      makeCtx(),
    );
    const meta = result.metadata as Record<string, unknown> | undefined;
    expect(meta?.shell).toBe('/bin/bash');
  });
});

describe('shell 工具 - abort 中止', () => {
  it('abort signal 触发后返回 exitCode -2', async () => {
    const controller = new AbortController();
    const cmd = isWindows ? 'ping -n 10 127.0.0.1 >nul' : 'sleep 10';
    // 100ms 后触发 abort
    setTimeout(() => controller.abort(), 100);
    const result = await shellTool.execute(
      { command: cmd, timeout: 10000 },
      makeCtx({ signal: controller.signal }),
    );
    const meta = result.metadata as Record<string, unknown> | undefined;
    expect(meta?.aborted).toBe(true);
    expect(meta?.exitCode).toBe(-2);
  });
});
