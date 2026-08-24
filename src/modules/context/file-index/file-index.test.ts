// src/modules/context/file-index/file-index.test.ts
// 文件索引模块单元测试：忽略规则 / scanner 增量 diff / chunker / 规则实体抽取 /
// 图谱符号与 import 提取（tree-sitter）/ 图谱存储与影响面 / SAG 存储与动态超边检索。
// 运行：bun test src/modules/context/file-index

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldIgnorePath, IgnoreGlobs, isDefaultIgnoredDir } from './shared/ignore';
import { scanIncremental, pathKey, classifyByExt, extOf, statEntry } from './shared/scanner';
import { chunkByLines, chunkBySymbols, chunkText, ruleSummary } from './sag-engine/chunker';
import { extractRuleEntities } from './sag-engine/extract-rules';
import { extractFile, resolveImportSource } from './graph-engine/extract';
import { GraphStore } from './graph-engine/store';
import { queryImpact, renderImpactText } from './graph-engine/impact';
import { SagStore, normalizeEntityName } from './sag-engine/store';
import { sagSearch } from './sag-engine/search';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'moss-file-index-'));
});

afterEach(() => {
  // Windows 下 SQLite WAL 句柄释放存在延迟：重试 + 容错（残留由系统临时目录清理）
  try {
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // 句柄未释放：跳过删除（不影响测试判定）
  }
});

// ---------------------------------------------------------------------------
// 忽略规则
// ---------------------------------------------------------------------------
describe('ignore 规则', () => {
  test('默认黑名单目录命中', () => {
    expect(isDefaultIgnoredDir('node_modules')).toBe(true);
    expect(isDefaultIgnoredDir('.git')).toBe(true);
    expect(isDefaultIgnoredDir('src')).toBe(false);
  });

  test('路径中任一目录段命中黑名单即忽略', () => {
    expect(shouldIgnorePath('node_modules/foo/index.js', null)).toBe(true);
    expect(shouldIgnorePath('src/node_modules/foo.js', null)).toBe(true);
    expect(shouldIgnorePath('src/foo.ts', null)).toBe(false);
  });

  test('隐藏文件/目录忽略（与 walkFiles dot=false 口径一致）', () => {
    expect(shouldIgnorePath('.env', null)).toBe(true);
    expect(shouldIgnorePath('src/.vscode/settings.json', null)).toBe(true);
  });

  test('自定义 glob 忽略', () => {
    const custom = IgnoreGlobs.compile(['**/*.test.ts', 'generated/**']);
    expect(custom).not.toBeNull();
    expect(shouldIgnorePath('src/foo.test.ts', custom)).toBe(true);
    expect(shouldIgnorePath('generated/out.ts', custom)).toBe(true);
    expect(shouldIgnorePath('src/foo.ts', custom)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanner 增量 diff
// ---------------------------------------------------------------------------
describe('scanIncremental', () => {
  test('首扫全量 added；变更 modified；删除 removed', async () => {
    writeFileSync(join(tmpRoot, 'a.ts'), 'const a = 1;\n');
    writeFileSync(join(tmpRoot, 'b.md'), '# doc\n\ncontent\n\nmore\n');
    mkdirSync(join(tmpRoot, 'sub'));
    writeFileSync(join(tmpRoot, 'sub', 'c.py'), 'print(1)\n');

    const first = await scanIncremental(tmpRoot, null, { customIgnore: null });
    expect(first.added.length).toBe(4); // a.ts b.md sub sub/c.py
    expect(first.modified.length).toBe(0);
    expect(first.removed.length).toBe(0);

    // 二次扫描（known=首扫快照）：无变化
    const known = {
      entries: new Map(
        [...first.added, ...first.modified].map(e => [pathKey(e.rel), { size: e.size, mtimeMs: e.mtimeMs }]),
      ),
    };
    const second = await scanIncremental(tmpRoot, known, { customIgnore: null });
    expect(second.added.length).toBe(0);
    expect(second.modified.length).toBe(0);
    expect(second.removed.length).toBe(0);

    // 新增 + 修改 + 删除
    writeFileSync(join(tmpRoot, 'new.ts'), 'export const x = 2;\n');
    writeFileSync(join(tmpRoot, 'a.ts'), 'const a = 2; // changed\n');
    rmSync(join(tmpRoot, 'b.md'));
    const third = await scanIncremental(tmpRoot, {
      entries: new Map(
        [...first.added, ...first.modified].map(e => [pathKey(e.rel), { size: e.size, mtimeMs: e.mtimeMs }]),
      ),
    }, { customIgnore: null });
    expect(third.added.map(e => e.rel)).toEqual(['new.ts']);
    expect(third.modified.map(e => e.rel)).toEqual(['a.ts']);
    expect(third.removed).toContain(pathKey('b.md'));
  });

  test('默认忽略目录不入扫描', async () => {
    mkdirSync(join(tmpRoot, 'node_modules'), { recursive: true });
    writeFileSync(join(tmpRoot, 'node_modules', 'dep.js'), 'x\n');
    writeFileSync(join(tmpRoot, 'ok.ts'), 'x\n');
    const result = await scanIncremental(tmpRoot, null, { customIgnore: null });
    expect(result.added.map(e => e.rel)).toEqual(['ok.ts']);
  });

  test('statEntry 单条目', async () => {
    writeFileSync(join(tmpRoot, 'x.ts'), 'abc\n');
    const e = await statEntry(tmpRoot, 'x.ts');
    expect(e).not.toBeNull();
    expect(e!.ext).toBe('.ts');
    expect(e!.kind).toBe('text');
    expect(e!.isDir).toBe(false);
    const none = await statEntry(tmpRoot, 'missing.ts');
    expect(none).toBeNull();
  });

  test('扩展名分类', () => {
    expect(classifyByExt('.ts')).toBe('text');
    expect(classifyByExt('.png')).toBe('binary');
    expect(classifyByExt('.xyz')).toBe('unknown');
    expect(extOf('foo.bar.ts')).toBe('.ts');
    expect(extOf('noext')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// chunker
// ---------------------------------------------------------------------------
describe('chunker', () => {
  test('固定行块切分', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const chunks = chunkByLines(lines);
    expect(chunks.length).toBe(2);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(80);
    expect(chunks[1].startLine).toBe(81);
    expect(chunks[1].endLine).toBe(100);
  });

  test('符号块切分（头部空隙并入首块，块间空行不独占）', () => {
    const lines = [
      '// header comment',
      '',
      'function foo() {',
      '  return 1;',
      '}',
      '',
      'class Bar {',
      '  method() {}',
      '}',
    ];
    const chunks = chunkBySymbols(lines, [{ line: 3, endLine: 5 }, { line: 7, endLine: 9 }]);
    // 头部空隙（前 2 行）并入首块
    expect(chunks.length).toBe(2);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(5);
    expect(chunks[0].content).toContain('// header comment');
    // 纯空行间隙不独占块（trim 为空跳过）
    expect(chunks[1].startLine).toBe(7);
    expect(chunks[1].endLine).toBe(9);
  });

  test('过小文件跳过', () => {
    expect(chunkText('a\nb\nc', false, null)).toBeNull();
    expect(chunkText('a\nb\nc\nd\ne', false, null)).not.toBeNull();
  });

  test('ruleSummary 取首个非注释非空行', () => {
    const summary = ruleSummary({ startLine: 1, endLine: 3, content: '// comment\n\nexport const x = 1;' }, true);
    expect(summary).toContain('export const x = 1;');
  });
});

// ---------------------------------------------------------------------------
// 规则实体抽取
// ---------------------------------------------------------------------------
describe('extractRuleEntities', () => {
  test('代码：标识符与路径组件', () => {
    const entities = extractRuleEntities(`import { readFile } from './shared/scanner';\nconst fileIndexService = new FileIndexService();`, true);
    const names = entities.map(e => e.name);
    expect(names).toContain('readFile');
    expect(names).toContain('fileIndexService');
    expect(names).toContain('FileIndexService');
    expect(entities.some(e => e.name === 'scanner' && e.type === 'path')).toBe(true);
  });

  test('文档：标题与行内代码', () => {
    const entities = extractRuleEntities('# 索引模块\n\n使用 `IndexEngine` 加速搜索。\n\n路径 src/modules/context。', false);
    const names = entities.map(e => e.name);
    expect(names).toContain('索引模块');
    expect(names).toContain('IndexEngine');
    expect(entities.some(e => e.type === 'path')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 图谱：tree-sitter 提取
// ---------------------------------------------------------------------------
describe('graph extract（web-tree-sitter）', () => {
  test('TS 符号与 import 边提取', async () => {
    const source = `import { foo } from './foo';

export function main(): void {
  foo(1);
}

export class Bar {
  method(): number { return 1; }
}

export interface Config { name: string }
`;
    // fileSet 为项目内已知文件（pathKey 小写）：./foo 相对 test/main.ts → test/foo.ts
    const fileSet = new Set<string>(['test/foo.ts']);
    const result = await extractFile('test/main.ts', '.ts', source, fileSet);
    expect(result.skipped).toBe(false);
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('main');
    expect(names).toContain('Bar');
    expect(names).toContain('Config');
    const mainFn = result.symbols.find(s => s.name === 'main')!;
    expect(mainFn.kind).toBe('function');
    expect(mainFn.line).toBe(3);
    // import 解析：./foo → test/foo.ts
    expect(result.imports).toEqual([{ src: 'test/main.ts', dst: 'test/foo.ts' }]);
  });

  test('非相对 import 丢弃（不猜）', async () => {
    const result = await extractFile('a.ts', '.ts', `import React from 'react';\nconst x = 1;\nconst y = 2;\nconst z = 3;\n`, new Set());
    expect(result.imports.length).toBe(0);
  });

  test('import 目标解析：扩展名补全与索引文件', () => {
    const fileSet = new Set(['src/foo.ts', 'src/bar/index.ts']);
    expect(resolveImportSource('./foo', 'src/main.ts', fileSet)).toBe('src/foo.ts');
    expect(resolveImportSource('./bar', 'src/main.ts', fileSet)).toBe('src/bar/index.ts');
    expect(resolveImportSource('../missing', 'src/main.ts', fileSet)).toBeNull();
    expect(resolveImportSource('react', 'src/main.ts', fileSet)).toBeNull();
  });

  test('不支持语言静默跳过', async () => {
    const result = await extractFile('data.bin', '.bin', 'binary', new Set());
    expect(result.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 图谱存储与影响面
// ---------------------------------------------------------------------------
describe('GraphStore + impact', () => {
  let store: GraphStore;
  beforeEach(() => {
    store = new GraphStore(join(tmpRoot, 'graph'));
  });
  afterEach(() => {
    store.close();
  });

  test('符号入库、上下游查询与影响面渲染', () => {
    const fileA = 'src/a.ts';
    const fileB = 'src/b.ts';
    store.replaceFile('src/a.ts', fileA,
      [{ file: fileA, name: 'foo', kind: 'function', line: 10, col: 1, endLine: 20, signature: 'function foo()' }],
      [{ src: fileA, dst: 'src/shared.ts' }],
    );
    store.replaceFile('src/b.ts', fileB,
      [{ file: fileB, name: 'bar', kind: 'function', line: 1, col: 1, endLine: 5, signature: 'function bar()' }],
      [{ src: fileB, dst: 'src/a.ts' }],
    );

    // 上游：谁 import 我
    expect(store.upstream('src/a.ts')).toEqual([fileB]);
    // 下游：我 import 谁
    expect(store.downstream('src/a.ts')).toEqual(['src/shared.ts']);
    // 文件符号
    expect(store.fileSymbols('src/a.ts').map(s => s.name)).toEqual(['foo']);

    const impact = queryImpact(store, 'src/a.ts');
    expect(impact.upstream).toEqual([fileB]);
    expect(impact.symbols.map(s => s.name)).toEqual(['foo']);

    const text = renderImpactText(impact);
    expect(text).toContain('[影响面]');
    expect(text).toContain('src/b.ts');
    expect(text).toContain('foo(function,L10)');

    // shared.ts 的上游：a.ts import 它（LEFT JOIN：目标未入库也返回）
    const sharedImpact = queryImpact(store, 'src/shared.ts');
    expect(sharedImpact.upstream).toEqual([fileA]);

    // 无上游且无符号的文件 → null（零噪音）
    expect(renderImpactText(queryImpact(store, 'unknown.ts'))).toBeNull();
  });

  test('replaceFile 事务替换（旧数据清除）', () => {
    store.replaceFile('x.ts', 'x.ts',
      [{ file: 'x.ts', name: 'old', kind: 'function', line: 1, col: 1, endLine: 2, signature: 'old' }],
      [],
    );
    store.replaceFile('x.ts', 'x.ts',
      [{ file: 'x.ts', name: 'new', kind: 'class', line: 1, col: 1, endLine: 2, signature: 'new' }],
      [],
    );
    expect(store.fileSymbols('x.ts').map(s => s.name)).toEqual(['new']);
    expect(store.counts().symbolCount).toBe(1);
  });

  test('符号搜索与 hub 文件', () => {
    store.replaceFile('a.ts', 'a.ts', [
      { file: 'a.ts', name: 'getUserData', kind: 'function', line: 1, col: 1, endLine: 2, signature: '' },
    ], []);
    store.replaceFile('b.ts', 'b.ts', [], [{ src: 'b.ts', dst: 'a.ts' }]);
    store.replaceFile('c.ts', 'c.ts', [], [{ src: 'c.ts', dst: 'a.ts' }]);

    const hits = store.searchSymbols('UserData', 10);
    expect(hits.length).toBe(1);
    expect(hits[0].name).toBe('getUserData');

    const hubs = store.hubFiles(5);
    expect(hubs[0].rel).toBe('a.ts');
    expect(hubs[0].importers).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SAG 存储与动态超边
// ---------------------------------------------------------------------------
describe('SagStore + sagSearch', () => {
  let store: SagStore;
  beforeEach(() => {
    store = new SagStore(join(tmpRoot, 'sag'));
  });
  afterEach(() => {
    store.close();
  });

  test('实体归一化', () => {
    expect(normalizeEntityName('FileIndexService')).toBe('fileindexservice');
    expect(normalizeEntityName('  foo-bar! ')).toBe('foobar');
  });

  test('chunk 入库 → 实体匹配种子 → 动态超边展开', () => {
    // 三个文件共享实体 'AuthService'：chunk1/chunk2 直接提及，chunk3 通过 chunk2 关联
    store.replaceFileChunks('auth.ts', 'auth.ts', [
      {
        startLine: 1, endLine: 10,
        content: 'export class AuthService { login() {} logout() {} }',
        summary: '定义 AuthService 认证服务',
        entities: [
          { name: 'AuthService', type: 'symbol' },
          { name: 'login', type: 'symbol' },
        ],
      },
    ]);
    store.replaceFileChunks('guard.ts', 'guard.ts', [
      {
        startLine: 1, endLine: 10,
        content: 'import { AuthService } from "./auth";\nexport function guard(auth: AuthService) {}',
        summary: '守卫使用 AuthService 做鉴权',
        entities: [
          { name: 'AuthService', type: 'symbol' },
          { name: 'guard', type: 'symbol' },
        ],
      },
    ]);
    store.replaceFileChunks('routes.ts', 'routes.ts', [
      {
        startLine: 1, endLine: 10,
        content: 'import { guard } from "./guard";\nrouter.use(guard);',
        summary: '路由挂载 guard 守卫',
        entities: [
          { name: 'guard', type: 'symbol' },
          { name: 'router', type: 'symbol' },
        ],
      },
    ]);

    // 查询 "AuthService 登录"：种子命中 auth/guard，超边经 guard 实体扩展到 routes
    const results = sagSearch(store, 'AuthService 登录');
    expect(results.length).toBeGreaterThan(0);
    const files = results.map(r => r.file);
    expect(files).toContain('auth.ts');
    expect(files).toContain('guard.ts');
    // 多跳：routes 通过共享实体 guard 与种子关联
    expect(files).toContain('routes.ts');

    const c = store.counts();
    expect(c.chunkCount).toBe(3);
    expect(c.entityCount).toBeGreaterThan(3);
  });

  test('空查询与无命中', () => {
    expect(sagSearch(store, '')).toEqual([]);
    store.replaceFileChunks('x.ts', 'x.ts', [
      { startLine: 1, endLine: 5, content: 'const a = 1;', summary: 'a', entities: [{ name: 'constA', type: 'symbol' }] },
    ]);
    expect(sagSearch(store, 'zzzz不存在的词')).toEqual([]);
  });

  test('LLM event 回写替换规则 event', () => {
    store.replaceFileChunks('x.ts', 'x.ts', [
      { startLine: 1, endLine: 5, content: 'const a = 1;', summary: 'rule summary', entities: [{ name: 'constA', type: 'symbol' }] },
    ]);
    expect(store.pendingLlmChunkIds(10).length).toBe(1);
    const chunkId = store.pendingLlmChunkIds(10)[0];
    store.writeLlmEvent(chunkId, 'LLM 语义摘要', [{ name: '新实体', type: 'concept' }]);
    expect(store.pendingLlmChunkIds(10).length).toBe(0);
    const c = store.counts();
    expect(c.eventCount).toBe(1); // 规则 event 被替换而非并存
    expect(c.llmExtracted).toBe(1);
    // 检索命中 LLM 摘要
    const results = sagSearch(store, '新实体');
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe('LLM 语义摘要');
  });

  test('topEntities 高频实体', () => {
    store.replaceFileChunks('a.ts', 'a.ts', [
      { startLine: 1, endLine: 5, content: 'x', summary: 's', entities: [{ name: 'Foo', type: 'symbol' }, { name: 'Bar', type: 'symbol' }] },
    ]);
    store.replaceFileChunks('b.ts', 'b.ts', [
      { startLine: 1, endLine: 5, content: 'y', summary: 's', entities: [{ name: 'Foo', type: 'symbol' }] },
    ]);
    const top = store.topEntities(2);
    expect(top[0].name).toBe('Foo');
    expect(top[0].refs).toBe(2);
  });
});
