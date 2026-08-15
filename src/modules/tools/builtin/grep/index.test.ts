// src/modules/tools/builtin/grep/index.test.ts
// grep 工具端到端测试：三输出模式/上下文行/smartCase/fixedStrings/multiline/type/noIgnore/分页/校验。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import grepTool from './index';
import type { ToolContext } from '../../types';

let tmpRoot: string;

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionId: 'test',
    cwd: tmpRoot,
    toolCallId: 'tc',
    emit: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    services: { tryResolve: () => null } as unknown as ToolContext['services'],
    ...overrides,
  } as unknown as ToolContext;
}

function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content[0].type === 'text' ? (r.content[0].text ?? '') : '';
}

/** 取结果正文行（去 header / 尾部 hint） */
function bodyLines(r: { content: Array<{ type: string; text?: string }> }): string[] {
  const raw = textOf(r).split('\n');
  return raw.slice(1).filter(l => l !== '' && !l.startsWith('(') && !l.includes('建议') && !l.includes('Results truncated'));
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'moss-grep-'));
  mkdirSync(join(tmpRoot, 'src'), { recursive: true });
  mkdirSync(join(tmpRoot, 'dist'), { recursive: true });
  // code.ts：多个 TODO + 大小写混排
  writeFileSync(
    join(tmpRoot, 'src/code.ts'),
    ['line1 start', 'TODO: first task', 'middle line', 'TODO: second task', 'Uppercase LINE', 'end'].join('\n'),
  );
  writeFileSync(join(tmpRoot, 'src/util.ts'), ['nothing here', 'todo lowercase style'].join('\n'));
  writeFileSync(join(tmpRoot, 'dist/gen.js'), 'TODO: generated');
  // 多行结构（multiline 测试）
  writeFileSync(join(tmpRoot, 'src/multi.ts'), 'function wrap() {\n  return 1;\n}\nconst x = wrap();\n');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('grep 工具 - content 模式', () => {
  it('基本搜索：行号 + 相对路径', async () => {
    const r = await grepTool.execute({ pattern: 'TODO' }, makeCtx());
    expect(r.isError).toBeUndefined();
    const ls = bodyLines(r);
    expect(ls.some(l => l.startsWith('src/code.ts:2:'))).toBe(true);
    expect(ls.some(l => l.startsWith('src/code.ts:4:'))).toBe(true);
    expect(ls.some(l => l.startsWith('dist/gen.js:'))).toBe(false); // dist 默认忽略
  });

  it('上下文行：before/after 用 - 分隔，匹配行用 : 分隔', async () => {
    const r = await grepTool.execute({ pattern: 'TODO: first', contextBefore: 1, contextAfter: 1 }, makeCtx());
    const ls = bodyLines(r);
    expect(ls).toContain('src/code.ts-1-line1 start');
    expect(ls).toContain('src/code.ts:2:TODO: first task');
    expect(ls).toContain('src/code.ts-3-middle line');
  });

  it('重叠上下文合并不重复输出', async () => {
    // 行 2 和行 4 都是 TODO，contextAfter=1 时行 3 只输出一次
    const r = await grepTool.execute({ pattern: 'TODO', contextAfter: 1 }, makeCtx());
    const ls = bodyLines(r);
    expect(ls.filter(l => l.includes('-3-'))).toHaveLength(1);
  });

  it('smartCase：纯小写 pattern 自动忽略大小写', async () => {
    const r = await grepTool.execute({ pattern: 'todo', smartCase: true }, makeCtx());
    const ls = bodyLines(r);
    expect(ls.some(l => l.startsWith('src/code.ts:2:'))).toBe(true); // 大写 TODO 命中
    expect(ls.some(l => l.startsWith('src/util.ts:2:'))).toBe(true); // 小写 todo 命中
  });

  it('smartCase 含大写时不忽略大小写', async () => {
    const r = await grepTool.execute({ pattern: 'TODO', smartCase: true }, makeCtx());
    const ls = bodyLines(r);
    expect(ls.some(l => l.startsWith('src/code.ts:2:'))).toBe(true);
    expect(ls.some(l => l.startsWith('src/util.ts:2:'))).toBe(false);
  });

  it('fixedStrings：正则元字符按字面量搜索', async () => {
    writeFileSync(join(tmpRoot, 'src/lit.ts'), 'const m = a.b(x);\nconst n = aXbXx;\n');
    const r = await grepTool.execute({ pattern: 'a.b(', fixedStrings: true }, makeCtx());
    const ls = bodyLines(r);
    expect(ls.some(l => l.startsWith('src/lit.ts:1:'))).toBe(true);
    expect(ls.some(l => l.startsWith('src/lit.ts:2:'))).toBe(false);
  });

  it('caseInsensitive 忽略大小写', async () => {
    const r = await grepTool.execute({ pattern: 'uppercase line', caseInsensitive: true }, makeCtx());
    expect(bodyLines(r).some(l => l.startsWith('src/code.ts:5:'))).toBe(true);
  });
});

describe('grep 工具 - files_with_matches / count 模式', () => {
  it('files_with_matches 仅返回文件路径', async () => {
    const r = await grepTool.execute({ pattern: 'TODO|todo', outputMode: 'files_with_matches' }, makeCtx());
    const ls = bodyLines(r);
    expect(ls).toContain('src/code.ts');
    expect(ls).toContain('src/util.ts');
    expect(ls.every(l => !l.match(/:\d+:/))).toBe(true);
  });

  it('count 模式输出每文件计数', async () => {
    const r = await grepTool.execute({ pattern: 'TODO', outputMode: 'count' }, makeCtx());
    const ls = bodyLines(r);
    expect(ls).toContain('src/code.ts:2');
  });
});

describe('grep 工具 - multiline', () => {
  it('跨行匹配（. 自动跨行），行号取起始行', async () => {
    const r = await grepTool.execute(
      { pattern: 'function wrap\\(\\) \\{.+return', multiline: true },
      makeCtx(),
    );
    const ls = bodyLines(r);
    expect(ls.some(l => l.startsWith('src/multi.ts:1:'))).toBe(true);
  });

  it('非 multiline 时 . 不跨行不命中', async () => {
    const r = await grepTool.execute({ pattern: 'function wrap\\(\\) \\{.+return' }, makeCtx());
    expect(bodyLines(r)).toEqual([]);
  });
});

describe('grep 工具 - 过滤与路径', () => {
  it('glob 文件名过滤', async () => {
    const r = await grepTool.execute({ pattern: 'todo', glob: 'util.ts' }, makeCtx());
    const ls = bodyLines(r);
    expect(ls.some(l => l.startsWith('src/util.ts:'))).toBe(true);
    expect(ls.some(l => l.startsWith('src/code.ts'))).toBe(false);
  });

  it('type 过滤：md 不在 ts 结果中', async () => {
    writeFileSync(join(tmpRoot, 'src/note.md'), 'TODO in md\n');
    const r = await grepTool.execute({ pattern: 'TODO', type: 'ts' }, makeCtx());
    const ls = bodyLines(r);
    expect(ls.some(l => l.startsWith('src/code.ts:'))).toBe(true);
    expect(ls.some(l => l.startsWith('src/note.md'))).toBe(false);
  });

  it('noIgnore 搜索 dist', async () => {
    const r = await grepTool.execute({ pattern: 'TODO', noIgnore: true }, makeCtx());
    expect(bodyLines(r).some(l => l.startsWith('dist/gen.js:'))).toBe(true);
  });

  it('path 指向单文件', async () => {
    const r = await grepTool.execute({ pattern: 'TODO', path: 'src/code.ts' }, makeCtx());
    const ls = bodyLines(r);
    expect(ls.length).toBe(2);
  });

  it('越权路径拒绝', async () => {
    const r = await grepTool.execute({ pattern: 'x', path: '../..' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('escapes working directory');
  });
});

describe('grep 工具 - 分页与校验', () => {
  it('offset 分页', async () => {
    const r1 = await grepTool.execute({ pattern: 'TODO', maxResults: 1 }, makeCtx());
    const r2 = await grepTool.execute({ pattern: 'TODO', maxResults: 1, offset: 1 }, makeCtx());
    const l1 = bodyLines(r1);
    const l2 = bodyLines(r2);
    expect(l1.length).toBe(1);
    expect(l2.length).toBe(1);
    expect(l1[0]).not.toBe(l2[0]);
    expect((r1.metadata as Record<string, unknown>).truncated).toBe(true);
  });

  it('灾难性回溯正则拒绝', async () => {
    const r = await grepTool.execute({ pattern: '(a+)+' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('unsafe regex');
  });

  it('fixedStrings 时跳过回溯预检（字面量安全）', async () => {
    const r = await grepTool.execute({ pattern: '(a+)+', fixedStrings: true }, makeCtx());
    expect(r.isError).toBeUndefined();
  });

  it('无效正则报错', async () => {
    const r = await grepTool.execute({ pattern: '[unclosed' }, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('超长 pattern 拒绝', async () => {
    const r = await grepTool.execute({ pattern: 'a'.repeat(501) }, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('pattern 缺失报错', async () => {
    const r = await grepTool.execute({}, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('signal 取消返回已完成部分', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await grepTool.execute({ pattern: 'TODO' }, makeCtx({ signal: ctrl.signal }));
    expect(r.isError).toBeUndefined();
    expect((r.metadata as Record<string, unknown>).cancelled).toBe(true);
  });
});
