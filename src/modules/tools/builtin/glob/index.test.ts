// src/modules/tools/builtin/glob/index.test.ts
// glob 工具端到端测试：多 pattern/否定/大括号/type/mtime 排序/分页/目录匹配/gitignore。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import globTool from './index';
import type { ToolContext } from '../../types';

let tmpRoot: string;

function makeCtx(cwd?: string): ToolContext {
  return {
    sessionId: 'test',
    cwd: cwd ?? tmpRoot,
    toolCallId: 'tc',
    emit: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    services: { tryResolve: () => null } as unknown as ToolContext['services'],
  } as unknown as ToolContext;
}

function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content[0].type === 'text' ? (r.content[0].text ?? '') : '';
}

function lines(text: string): string[] {
  return text.split('\n').slice(1); // 去 header
}

/** 显式设置 mtime（避免同毫秒精度问题） */
function setMtime(path: string, secondsAgo: number): void {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(path, t, t);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'moss-glob-'));
  mkdirSync(join(tmpRoot, 'src'), { recursive: true });
  mkdirSync(join(tmpRoot, 'docs'), { recursive: true });
  mkdirSync(join(tmpRoot, 'dist'), { recursive: true });
  mkdirSync(join(tmpRoot, '.hidden'), { recursive: true });
  writeFileSync(join(tmpRoot, 'src/a.ts'), 'a');
  writeFileSync(join(tmpRoot, 'src/b.tsx'), 'b');
  writeFileSync(join(tmpRoot, 'src/a.test.ts'), 't');
  writeFileSync(join(tmpRoot, 'docs/readme.md'), 'm');
  writeFileSync(join(tmpRoot, 'docs/note.txt'), 'n');
  writeFileSync(join(tmpRoot, 'dist/bundle.js'), 'j');
  writeFileSync(join(tmpRoot, '.hidden/s.ts'), 's');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('glob 工具 - 基础匹配', () => {
  it('单 pattern 返回相对路径', async () => {
    const r = await globTool.execute({ pattern: 'src/*.ts' }, makeCtx());
    expect(r.isError).toBeUndefined();
    const ls = lines(textOf(r));
    expect(ls).toContain('src/a.ts');
    expect(ls).toContain('src/a.test.ts');
    expect(ls).not.toContain('src/b.tsx');
  });

  it('大括号展开 {ts,tsx}', async () => {
    const r = await globTool.execute({ pattern: 'src/*.{ts,tsx}' }, makeCtx());
    const ls = lines(textOf(r));
    expect(ls).toContain('src/a.ts');
    expect(ls).toContain('src/b.tsx');
  });

  it('多 pattern 数组取并集，负模式排除', async () => {
    const r = await globTool.execute(
      { pattern: ['src/**/*.ts', 'docs/*.md', '!**/*.test.ts'] },
      makeCtx(),
    );
    const ls = lines(textOf(r));
    expect(ls).toContain('src/a.ts');
    expect(ls).toContain('docs/readme.md');
    expect(ls).not.toContain('src/a.test.ts');
  });

  it('pattern 缺失报错', async () => {
    const r = await globTool.execute({}, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('无匹配返回无匹配占位', async () => {
    const r = await globTool.execute({ pattern: '**/*.nope' }, makeCtx());
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain('Found 0 entries');
  });
});

describe('glob 工具 - type / ignore / dot', () => {
  it('type=ts 命中 ts/tsx 且排除其他类型', async () => {
    const r = await globTool.execute({ pattern: '**/*', type: 'ts' }, makeCtx());
    const ls = lines(textOf(r));
    expect(ls).toContain('src/a.ts');
    expect(ls).toContain('src/b.tsx');
    expect(ls).not.toContain('docs/readme.md');
  });

  it('未知 type 报错并列出支持的类型', async () => {
    const r = await globTool.execute({ pattern: '**/*', type: 'nope' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('ts');
  });

  it('默认跳过 dist（DEFAULT_IGNORES），noIgnore 穿透', async () => {
    const normal = await globTool.execute({ pattern: '**/*.js' }, makeCtx());
    expect(lines(textOf(normal))).not.toContain('dist/bundle.js');
    const noIgnore = await globTool.execute({ pattern: '**/*.js', noIgnore: true }, makeCtx());
    expect(lines(textOf(noIgnore))).toContain('dist/bundle.js');
  });

  it('dot 包含隐藏文件', async () => {
    const r = await globTool.execute({ pattern: '**/*.ts', dot: true }, makeCtx());
    expect(lines(textOf(r))).toContain('.hidden/s.ts');
  });

  it('.gitignore 规则生效且 noIgnore 穿透', async () => {
    writeFileSync(join(tmpRoot, '.gitignore'), '*.md\n');
    const normal = await globTool.execute({ pattern: '**/*.md' }, makeCtx());
    expect(lines(textOf(normal)).filter(l => l.endsWith('.md'))).toEqual([]);
    const noIgnore = await globTool.execute({ pattern: '**/*.md', noIgnore: true }, makeCtx());
    expect(lines(textOf(noIgnore))).toContain('docs/readme.md');
  });
});

describe('glob 工具 - 排序与分页', () => {
  it('mtime 降序：最近修改优先', async () => {
    setMtime(join(tmpRoot, 'src/a.ts'), 1);      // 1 秒前
    setMtime(join(tmpRoot, 'src/a.test.ts'), 100); // 100 秒前
    setMtime(join(tmpRoot, 'src/b.tsx'), 500);   // 500 秒前
    const r = await globTool.execute({ pattern: 'src/*', sortBy: 'mtime' }, makeCtx());
    const ls = lines(textOf(r));
    expect(ls[0]).toBe('src/a.ts');
    expect(ls[1]).toBe('src/a.test.ts');
    expect(ls[2]).toBe('src/b.tsx');
  });

  it('sortBy=path 字典序', async () => {
    const r = await globTool.execute({ pattern: 'src/*', sortBy: 'path' }, makeCtx());
    const ls = lines(textOf(r));
    expect(ls.indexOf('src/a.test.ts')).toBeLessThan(ls.indexOf('src/a.ts'));
    expect(ls.indexOf('src/a.ts')).toBeLessThan(ls.indexOf('src/b.tsx'));
  });

  it('offset 分页 + truncated 提示', async () => {
    const r = await globTool.execute({ pattern: 'src/*', offset: 1, maxResults: 1 }, makeCtx());
    const text = textOf(r);
    const meta = r.metadata as Record<string, unknown>;
    expect(meta.truncated).toBe(true);
    expect(text).toContain('showing 2-2');
    expect(meta.returned).toBe(1);
  });
});

describe('glob 工具 - 目录与路径', () => {
  it('includeDirs 包含目录', async () => {
    const r = await globTool.execute({ pattern: 'src', includeDirs: true }, makeCtx());
    expect(lines(textOf(r))).toContain('src');
  });

  it('path 指定子目录', async () => {
    const r = await globTool.execute({ pattern: '*.md', path: 'docs' }, makeCtx());
    expect(lines(textOf(r))).toContain(join('docs', 'readme.md').split('\\').join('/'));
  });

  it('越权路径拒绝', async () => {
    const r = await globTool.execute({ pattern: '*', path: '../..' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('escapes working directory');
  });

  it('path 不存在报错', async () => {
    const r = await globTool.execute({ pattern: '*', path: 'no-such-dir' }, makeCtx());
    expect(r.isError).toBe(true);
  });
});
