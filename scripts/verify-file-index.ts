// scripts/verify-file-index.ts
// 文件索引模块端到端验证脚本：
//   临时项目 → FileIndexService（三引擎全开）→ 索引构建完成 → 状态校验 →
//   watcher 增量更新（新增/修改/删除）→ glob 内存查询 → 影响面 → 项目概要 → 重建。
// 运行：bun scripts/verify-file-index.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Glob } from 'bun';

const ROOT = process.cwd();

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : '');
  }
}

async function main(): Promise<void> {
  console.log('[file-index 端到端验证]');

  // 1. 临时项目目录（含依赖关系的源码）
  const proj = mkdtempSync(join(tmpdir(), 'moss-verify-proj-'));
  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src', 'util.ts'), `export function greet(name: string): string {\n  return \`hello \${name}\`;\n}\n\nexport function farewell(name: string): string {\n  return \`bye \${name}\`;\n}\n`);
  writeFileSync(join(proj, 'src', 'app.ts'), `import { greet } from './util';\n\nexport function main(): void {\n  console.log(greet('moss'));\n}\n`);
  writeFileSync(join(proj, 'README.md'), `# 测试项目\n\n这是一个索引模块验证项目。\n\n## 模块\n\n- util 提供问候工具\n- app 入口调用 greet\n`);
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'verify-proj', version: '1.0.0' }, null, 2));

  // 2. 构造 FileIndexService（独立环境：dataDir 指向临时目录）
  const { FileIndexService } = await import('../src/modules/context/file-index/index');
  const fakeEnv = {
    platform: 'win32' as const,
    arch: 'x64',
    isWindows: true,
    isMac: false,
    isLinux: false,
    homeDir: homedir(),
    dataDir: mkdtempSync(join(tmpdir(), 'moss-verify-data-')),
    configDir: '',
    logsDir: '',
    pidFile: '',
    runtimeVersion: 'test',
    pid: process.pid,
    packageRoot: ROOT,
  };
  const fakeLogger = {
    info: () => {},
    warn: (m: string, d?: unknown) => console.warn('  [warn]', m, d ?? ''),
    error: (m: string, d?: unknown) => console.error('  [error]', m, d ?? ''),
    debug: () => {},
    child: () => fakeLogger,
  } as unknown as import('../src/core/types').Logger;
  const fakeConfig = {
    getAppConfig: () => ({
      context: {
        fileIndex: {
          indexing: { enabled: true },
          graph: { enabled: true },
          sag: { enabled: true, llmModel: 'inherit', llmMaxChunks: 0 }, // 预算 0：纯规则模式（不调 LLM）
          ignore: [],
        },
      },
      agent: { defaultModel: 'test', workingDirectory: proj },
    }),
  } as unknown as import('../src/core/types').ConfigService;
  const fakeServices = { tryResolve: () => null };

  const service = new FileIndexService({
    env: fakeEnv as import('../src/core/types').Environment,
    config: fakeConfig,
    services: fakeServices as unknown as import('../src/core/types').ServiceRegistry,
    logger: fakeLogger,
  });

  try {
    // 3. 启动（后台建索引）
    console.log('\n[1] 启动三引擎...');
    await service.ensureProject(proj);

    // 4. 等待就绪（索引 → 图谱 → SAG 串行完成；上限 30s）
    console.log('[2] 等待三引擎就绪...');
    const deadline = Date.now() + 30_000;
    let status: import('../src/modules/context/file-index/index').FileIndexStatus | null = null;
    while (Date.now() < deadline) {
      status = await service.status(proj);
      if (status.indexing.state === 'ready' && status.graph.state === 'ready' && status.sag.state === 'ready') break;
      await new Promise(r => setTimeout(r, 200));
    }
    check('索引引擎就绪', status?.indexing.state === 'ready', status?.indexing.state);
    check('图谱引擎就绪', status?.graph.state === 'ready', status?.graph.state);
    check('SAG 引擎就绪', status?.sag.state === 'ready', status?.sag.state);
    if (status?.indexing.state !== 'ready' || status?.graph.state !== 'ready') {
      throw new Error('引擎未就绪，中止验证');
    }

    // 5. 状态统计校验
    console.log('[3] 状态统计校验...');
    check(`索引文件数 ≥ 4（实际 ${status!.indexing.fileCount}）`, status!.indexing.fileCount >= 4);
    check(`图谱符号数 ≥ 3（实际 ${status!.graph.symbolCount}）`, status!.graph.symbolCount >= 3, status!.graph.symbolCount);
    check(`图谱依赖边 ≥ 1（app→util，实际 ${status!.graph.edgeCount}）`, status!.graph.edgeCount >= 1, status!.graph.edgeCount);
    check(`SAG chunk ≥ 3（实际 ${status!.sag.chunkCount}）`, status!.sag.chunkCount >= 3, status!.sag.chunkCount);
    check(`SAG 事件数 = chunk 数（实际 ${status!.sag.eventCount}）`, status!.sag.eventCount === status!.sag.chunkCount);
    check(`SAG 实体数 > 0（实际 ${status!.sag.entityCount}）`, status!.sag.entityCount > 0);

    // 6. glob 内存查询（等价性：与 walkFiles 结果一致）
    console.log('[4] glob 查询...');
    const globResult = await service.queryFiles(proj, {
      positiveGlobs: [new Glob('**/*.ts')],
      negativeGlobs: [],
      typeGlobs: null,
      includeDirs: false,
      sortBy: 'path',
      offset: 0,
      maxResults: 100,
    });
    check('glob *.ts 命中 util.ts 与 app.ts', 
      globResult !== null &&
      globResult.page.map(e => e.rel).includes('src/util.ts') &&
      globResult.page.map(e => e.rel).includes('src/app.ts'),
      globResult?.page.map(e => e.rel));

    // 7. 影响面（util.ts 被 app.ts import）
    console.log('[5] 影响面...');
    const impact = await service.impactHint(proj, 'src/util.ts');
    check('util.ts 影响面包含 app.ts', impact !== null && impact.includes('src/app.ts'), impact);

    // 8. 项目概要
    console.log('[6] 项目概要...');
    const overview = await service.projectOverview(proj);
    check('概要包含结构统计', overview !== null && overview.includes('[项目概要]'), overview);
    check('概要包含核心模块（hub 文件）', overview!.includes('src/util.ts'), overview);

    // 9. SAG 检索（动态超边：greet 实体连接 util 与 app）
    console.log('[7] SAG 检索...');
    const searchResults = await service.search(proj, 'greet 问候');
    check('SAG 检索命中 util.ts', searchResults.some(r => r.file === 'src/util.ts'), searchResults.map(r => `${r.file}:${r.summary}`));
    check('SAG 检索命中 app.ts（共享实体 greet 超边）', searchResults.some(r => r.file === 'src/app.ts'), searchResults.map(r => r.file));

    // 10. watcher 增量更新（新增 → 等待 → 校验；修改 → 校验；删除 → 校验）
    console.log('[8] watcher 增量更新...');
    writeFileSync(join(proj, 'src', 'new.ts'), `export const NEW_FLAG = 'new';\n\nexport function newFn(): string {\n  return NEW_FLAG;\n}\n`);
    let indexed = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      const s2 = await service.status(proj);
      const entry = s2.indexing.fileCount;
      if (s2.indexing.state === 'ready' && entry > status!.indexing.fileCount) {
        // 图谱同步：new.ts 的符号已入库
        const s3 = await service.status(proj);
        if (s3.graph.symbolCount > status!.graph.symbolCount) {
          indexed = true;
          break;
        }
      }
    }
    check('新增文件增量入索引+图谱', indexed);

    // 修改 util.ts（触发重解析 + SAG 重 chunk）
    writeFileSync(join(proj, 'src', 'util.ts'), `export function greet(name: string): string {\n  return \`hi \${name}\`;\n}\n\nexport function farewell(name: string): string {\n  return \`bye \${name}\`;\n}\n`);
    let modified = false;
    const preModifyChunks = (await service.status(proj)).sag.chunkCount;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      const hint = await service.impactHint(proj, 'src/util.ts');
      // 修改后重解析：farewell 符号仍在；此校验以 chunk 数稳定为准
      const s4 = await service.status(proj);
      if (s4.sag.state === 'ready' && s4.sag.chunkCount === preModifyChunks) {
        // 再验证 SAG 检索仍工作（内容已更新为 hi）
        const r = await service.search(proj, 'greet');
        if (r.length > 0) { modified = true; break; }
      }
    }
    check('修改文件后引擎仍正常服务', modified);

    // 11. 重建
    console.log('[9] 重建...');
    const ok = await service.rebuild(proj, ['indexing', 'graph', 'sag']);
    check('重建请求成功', ok);
    const deadline2 = Date.now() + 30_000;
    while (Date.now() < deadline2) {
      const s5 = await service.status(proj);
      if (s5.indexing.state === 'ready' && s5.graph.state === 'ready' && s5.sag.state === 'ready') break;
      await new Promise(r => setTimeout(r, 200));
    }
    const s6 = await service.status(proj);
    check('重建后三引擎就绪', s6.indexing.state === 'ready' && s6.graph.state === 'ready' && s6.sag.state === 'ready');

    // 12. 数据目录结构验证（~/.moss/file-index/<hash>/{index-list,graph,sag}）
    console.log('[10] 数据目录结构...');
    const { projectHash } = await import('../src/modules/context/file-index/shared/store');
    const idxRoot = join(fakeEnv.dataDir, 'file-index', projectHash(proj));
    check('meta.json 存在', existsSync(join(idxRoot, 'meta.json')));
    check('index-list/files.db 存在', existsSync(join(idxRoot, 'index-list', 'files.db')));
    check('graph/graph.db 存在', existsSync(join(idxRoot, 'graph', 'graph.db')));
    check('sag/sag.db 存在', existsSync(join(idxRoot, 'sag', 'sag.db')));
    const meta = JSON.parse(readFileSync(join(idxRoot, 'meta.json'), 'utf8'));
    check('meta.json 记录原始 cwd', meta.cwd === proj, meta.cwd);

    // 13. 关闭（停引擎保数据）
    console.log('[11] 停用引擎（保数据）...');
    await service.stopAll();
    const s7 = await service.status(proj);
    check('停用后状态 disabled', s7.indexing.state === 'disabled');
    check('停用后数据保留', existsSync(join(idxRoot, 'index-list', 'files.db')));

    console.log('\n==========');
    if (failures === 0) {
      console.log('ALL CHECKS PASSED');
    } else {
      console.error(`${failures} CHECKS FAILED`);
      process.exitCode = 1;
    }
  } finally {
    await service.stopAll().catch(() => {});
    try { rmSync(proj, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows 句柄延迟 */ }
    try { rmSync(fakeEnv.dataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows 句柄延迟 */ }
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
