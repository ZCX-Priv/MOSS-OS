// src/modules/tools/shared/search-core.test.ts
// search-core 单元测试：TYPE_MAP / GitignoreMatcher / walkFiles / 二进制检测 / 显示路径。
// 运行：bun test src/modules/tools/shared

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  typeToGlobs,
  SUPPORTED_TYPES,
  GitignoreMatcher,
  walkFiles,
  readFileHead,
  isBinaryBufferHead,
  toDisplayPath,
} from './search-core';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'moss-search-core-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// TYPE_MAP
// ---------------------------------------------------------------------------
describe('typeToGlobs', () => {
  test('ts 类型映射到四种扩展名', () => {
    expect(typeToGlobs('ts')).toEqual(['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']);
  });

  test('未知类型返回 null', () => {
    expect(typeToGlobs('nope')).toBeNull();
  });

  test('支持的类型清单包含常用类型', () => {
    expect(SUPPORTED_TYPES).toContain('ts');
    expect(SUPPORTED_TYPES).toContain('py');
    expect(SUPPORTED_TYPES).toContain('rust');
  });
});

// ---------------------------------------------------------------------------
// GitignoreMatcher
// ---------------------------------------------------------------------------
describe('GitignoreMatcher', () => {
  test('基础扩展名规则匹配任意层级', () => {
    const m = GitignoreMatcher.parse('*.log')!;
    expect(m.decide('a.log', false)).toBe(true);
    expect(m.decide('a/b/c.log', false)).toBe(true);
    expect(m.decide('src/main.ts', false)).toBeNull();
  });

  test('目录规则只对目录生效', () => {
    const m = GitignoreMatcher.parse('build/')!;
    expect(m.decide('build', true)).toBe(true);
    expect(m.decide('build', false)).toBeNull(); // 文件名 build 不命中目录规则
    expect(m.decide('a/build', true)).toBe(true); // 任意层级目录
    expect(m.decide('a/build/x.ts', false)).toBe(true); // 中间段命中目录规则
  });

  test('否定规则覆盖先前规则', () => {
    const m = GitignoreMatcher.parse('*.log\n!keep.log')!;
    expect(m.decide('a.log', false)).toBe(true);
    expect(m.decide('keep.log', false)).toBe(false);
  });

  test('含 / 规则相对所在目录锚定', () => {
    const m = GitignoreMatcher.parse('src/temp/*.tmp')!;
    expect(m.decide('src/temp/a.tmp', false)).toBe(true);
    expect(m.decide('other/temp/a.tmp', false)).toBeNull(); // 深层同名目录不命中
  });

  test('前导 / 根锚定', () => {
    const m = GitignoreMatcher.parse('/dist')!;
    expect(m.decide('dist', true)).toBe(true);
    expect(m.decide('a/dist', true)).toBeNull(); // 非根层级不命中
  });

  test('注释与空行跳过；纯注释返回 null', () => {
    expect(GitignoreMatcher.parse('# comment\n\n  \n')).toBeNull();
  });

  test('glob 通配符规则', () => {
    const m = GitignoreMatcher.parse('temp-*')!;
    expect(m.decide('temp-cache', true)).toBe(true);
    expect(m.decide('a/temp-xyz', false)).toBe(true);
    expect(m.decide('temp', true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// walkFiles
// ---------------------------------------------------------------------------
async function collect(gen: AsyncGenerator<{ rel: string; isDir: boolean }>): Promise<string[]> {
  const out: string[] = [];
  for await (const e of gen) out.push(e.isDir ? `${e.rel}/` : e.rel);
  return out.sort();
}

function scaffold(): void {
  // 结构：
  //   src/a.ts, src/b.tsx, src/deep/c.mts, src/nested/deeper/d.ts
  //   node_modules/pkg/index.js（应剪枝）
  //   logs/app.log, logs/keep.log
  //   dist/out.js, other/dist/keep.txt（DEFAULT_IGNORES 目录名任意层级剪枝，同旧 IGNORED_DIRS 行为）
  //   .hidden/secret.ts, visible.ts, .git/config（.git 无条件跳过）
  mkdirSync(join(tmpRoot, 'src/deep'), { recursive: true });
  mkdirSync(join(tmpRoot, 'src/nested/deeper'), { recursive: true });
  mkdirSync(join(tmpRoot, 'node_modules/pkg'), { recursive: true });
  mkdirSync(join(tmpRoot, 'logs'), { recursive: true });
  mkdirSync(join(tmpRoot, 'dist'), { recursive: true });
  mkdirSync(join(tmpRoot, 'other/dist'), { recursive: true });
  mkdirSync(join(tmpRoot, '.hidden'), { recursive: true });
  mkdirSync(join(tmpRoot, '.git'), { recursive: true });
  writeFileSync(join(tmpRoot, 'src/a.ts'), 'a');
  writeFileSync(join(tmpRoot, 'src/b.tsx'), 'b');
  writeFileSync(join(tmpRoot, 'src/deep/c.mts'), 'c');
  writeFileSync(join(tmpRoot, 'src/nested/deeper/d.ts'), 'd');
  writeFileSync(join(tmpRoot, 'node_modules/pkg/index.js'), 'x');
  writeFileSync(join(tmpRoot, 'logs/app.log'), 'l');
  writeFileSync(join(tmpRoot, 'logs/keep.log'), 'k');
  writeFileSync(join(tmpRoot, 'dist/out.js'), 'o');
  writeFileSync(join(tmpRoot, 'other/dist/keep.txt'), 't');
  writeFileSync(join(tmpRoot, '.hidden/secret.ts'), 's');
  writeFileSync(join(tmpRoot, 'visible.ts'), 'v');
  writeFileSync(join(tmpRoot, '.git/config'), 'g');
  writeFileSync(
    join(tmpRoot, '.gitignore'),
    ['*.log', '!keep.log', 'src/nested/deeper/', '# comment', ''].join('\n'),
  );
}

describe('walkFiles', () => {
  beforeEach(scaffold);

  test('默认：gitignore + DEFAULT_IGNORES + 隐藏文件过滤', async () => {
    const got = await collect(walkFiles(tmpRoot));
    expect(got).toEqual([
      '.gitignore',
      'logs/keep.log', // *.log 忽略但 !keep.log 否定
      'src/a.ts',
      'src/b.tsx',
      'src/deep/c.mts',
      'visible.ts',
    ]);
  });

  test('noIgnore：穿透 gitignore（DEFAULT_IGNORES 也放行，.git 仍无条件跳过）', async () => {
    const got = await collect(walkFiles(tmpRoot, { noIgnore: true }));
    expect(got).toContain('logs/app.log');
    expect(got).toContain('src/nested/deeper/d.ts');
    expect(got).toContain('dist/out.js');
    expect(got).toContain('node_modules/pkg/index.js');
    expect(got).toContain('other/dist/keep.txt');
    expect(got).not.toContain('.hidden/secret.ts'); // 隐藏文件仍受 dot 控制
    expect(got.filter(p => p.startsWith('.git/'))).toEqual([]); // .git 永远跳过
  });

  test('dot：包含隐藏文件', async () => {
    const got = await collect(walkFiles(tmpRoot, { dot: true }));
    expect(got).toContain('.hidden/secret.ts');
  });

  test('includeDirs：目录也产出', async () => {
    const got = await collect(walkFiles(tmpRoot, { includeDirs: true }));
    expect(got).toContain('src/');
    expect(got).toContain('logs/');
    expect(got).toContain('src/deep/');
  });

  test('子目录 .gitignore 深层覆盖浅层', async () => {
    mkdirSync(join(tmpRoot, 'src'), { recursive: true });
    writeFileSync(join(tmpRoot, 'src/.gitignore'), '!a.ts\n*.tsx\n');
    writeFileSync(join(tmpRoot, 'src/extra.tsx'), 'e');
    const got = await collect(walkFiles(tmpRoot));
    // 根层 nested/deeper/ 仍然剪枝；src 内 tsx 被子 gitignore 忽略
    expect(got).not.toContain('src/b.tsx');
    expect(got).not.toContain('src/extra.tsx');
    expect(got).toContain('src/a.ts');
  });

  test('maxFiles 提前终止', async () => {
    const got = await collect(walkFiles(tmpRoot, { maxFiles: 2 }));
    expect(got.length).toBeLessThanOrEqual(2);
  });

  test('signal 取消', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const got = await collect(walkFiles(tmpRoot, { signal: ctrl.signal }));
    expect(got).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 二进制检测
// ---------------------------------------------------------------------------
describe('isBinaryBufferHead / readFileHead', () => {
  test('空 Buffer 非二进制', () => {
    expect(isBinaryBufferHead(Buffer.alloc(0))).toBe(false);
  });

  test('含 NUL 字节视为二进制', () => {
    expect(isBinaryBufferHead(Buffer.from([0x61, 0x00, 0x62]))).toBe(true);
  });

  test('纯中文 UTF-8 是文本（不被误判）', () => {
    expect(isBinaryBufferHead(Buffer.from('你好世界，中文内容', 'utf8'))).toBe(false);
  });

  test('非法 UTF-8 视为二进制', () => {
    expect(isBinaryBufferHead(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(true);
  });

  test('readFileHead 只读前 N 字节', async () => {
    const file = join(tmpRoot, 'big.txt');
    writeFileSync(file, 'x'.repeat(100));
    const head = await readFileHead(file, 10);
    expect(head.length).toBe(10);
  });

  test('readFileHead 短文件返回实际长度', async () => {
    const file = join(tmpRoot, 'small.txt');
    writeFileSync(file, 'abc');
    const head = await readFileHead(file, 8192);
    expect(head.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// toDisplayPath
// ---------------------------------------------------------------------------
describe('toDisplayPath', () => {
  test('cwd 内返回相对路径', () => {
    expect(toDisplayPath(join(tmpRoot, 'src', 'a.ts'), tmpRoot)).toBe('src/a.ts');
  });

  test('cwd 自身返回 .', () => {
    expect(toDisplayPath(tmpRoot, tmpRoot)).toBe('.');
  });

  test('cwd 外返回绝对路径', () => {
    const outside = join(tmpdir(), 'outside-file.txt');
    expect(toDisplayPath(outside, tmpRoot)).toBe(outside);
  });
});
