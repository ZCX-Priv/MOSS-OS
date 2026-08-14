// src/modules/tools/specs.ts
// Spec 注册表：从 agent/prompts/main/spec/ 目录递归加载 .md 文件
// （YAML front-matter + Markdown body），支持子目录组织。
// 加载顺序：包内模板 agent/prompts/main/spec/ → 用户目录
// ~/.moss/agent/prompts/main/spec/（同 id 覆盖）。
// 支持热重载：递归监听用户 spec 目录变更，自动增删 spec。

import { t } from '../../core/i18n';
import { stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join, relative } from 'node:path';
import type { Environment, EventBus, Logger } from '../../core/types';
import { ServiceNames } from '../../core/types';

/** 旧常量保留，值等于 ServiceNames.SPEC_REGISTRY，向后兼容 */
export const SPEC_REGISTRY_SERVICE = ServiceNames.SPEC_REGISTRY;

export interface Spec {
  /** 唯一标识：相对 spec/ 根目录的路径去 .md 后缀，分隔符统一为 / */
  id: string;
  /** 来自 front-matter 的描述（可选，缺失为空串） */
  description: string;
  /** Markdown body（front-matter 已剥离），由 get_spec 返回 */
  content: string;
  /** 来源文件绝对路径（用于热重载定位） */
  sourceFile: string;
}

export interface SpecRegistry {
  register(spec: Spec): void;
  unregister(id: string): void;
  get(id: string): Spec | null;
  list(): Spec[];
  /**
   * 替换某个来源文件对应的 spec（热重载用）。
   * 若新 spec 的 id 与已注册的同 id spec 冲突但 sourceFile 不同，则跳过（旧优先）。
   */
  reloadBySourceFile(sourceFile: string, spec: Spec): void;
  /** 移除指定来源文件对应的 spec（文件删除时调用） */
  removeBySourceFile(sourceFile: string): void;
}

class SpecRegistryImpl implements SpecRegistry {
  private readonly specs = new Map<string, Spec>();
  /** sourceFile -> spec id 索引（热重载定位用） */
  private readonly fileIndex = new Map<string, string>();

  register(spec: Spec): void {
    const existing = this.specs.get(spec.id);
    if (existing?.sourceFile) {
      this.fileIndex.delete(existing.sourceFile);
    }
    this.specs.set(spec.id, spec);
    if (spec.sourceFile) {
      this.fileIndex.set(spec.sourceFile, spec.id);
    }
  }

  unregister(id: string): void {
    const existing = this.specs.get(id);
    if (existing?.sourceFile) {
      this.fileIndex.delete(existing.sourceFile);
    }
    this.specs.delete(id);
  }

  get(id: string): Spec | null {
    return this.specs.get(id) ?? null;
  }

  list(): Spec[] {
    return Array.from(this.specs.values());
  }

  reloadBySourceFile(sourceFile: string, spec: Spec): void {
    const oldId = this.fileIndex.get(sourceFile);
    // 若文件曾注册过且 id 变了，先移除旧的
    if (oldId && oldId !== spec.id) {
      this.specs.delete(oldId);
      this.fileIndex.delete(sourceFile);
    }
    // 同 id spec 若已被其他来源占用，保留先注册的
    const existing = this.specs.get(spec.id);
    if (existing && existing.sourceFile !== sourceFile) {
      // id 冲突，跳过（先注册者优先）
      return;
    }
    this.specs.set(spec.id, spec);
    this.fileIndex.set(sourceFile, spec.id);
  }

  removeBySourceFile(sourceFile: string): void {
    const id = this.fileIndex.get(sourceFile);
    if (id) {
      this.specs.delete(id);
      this.fileIndex.delete(sourceFile);
    }
  }
}

/**
 * 创建 Spec 注册表：从包内 agent/prompts/main/spec/ 与用户
 * ~/.moss/agent/prompts/main/spec/ 递归加载 .md 文件。
 * 用户目录同 id 覆盖包内模板。监听用户目录变更实现热重载。
 */
export function createSpecRegistry(
  env: Environment,
  logger: Logger,
  eventBus: EventBus,
): SpecRegistry {
  const reg = new SpecRegistryImpl();
  const builtinDir = join(env.packageRoot, 'agent', 'prompts', 'main', 'spec');
  const userDir = join(env.dataDir, 'agent', 'prompts', 'main', 'spec');

  // 同步加载（注册表在 tools 模组 initialize 时立即需要）
  // 包内模板先加载
  loadSpecsFromDirSync(reg, builtinDir, builtinDir, logger);
  // 用户目录后加载（覆盖同 id）
  loadSpecsFromDirSync(reg, userDir, userDir, logger);

  // 启动热重载监听（异步，不阻塞初始化）
  startWatch(reg, userDir, logger, eventBus).catch(err => {
    logger.debug(t('tools.specWatchFailed'), {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return reg;
}

/** 同步递归从目录加载所有 .md spec 文件 */
function loadSpecsFromDirSync(
  reg: SpecRegistry,
  dir: string,
  specRootDir: string,
  logger: Logger,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st: { isDirectory(): boolean; isFile(): boolean };
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // 递归子目录
      loadSpecsFromDirSync(reg, full, specRootDir, logger);
    } else if (st.isFile() && entry.endsWith('.md')) {
      try {
        const spec = parseSpecFile(full, specRootDir);
        if (spec) {
          reg.reloadBySourceFile(full, spec);
        }
      } catch (err) {
        logger.warn(t('tools.loadSpecFailed', { file: full }), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * 解析 spec .md 文件：YAML front-matter + Markdown body。
 * front-matter 可选含 description（缺失为空串）。
 * body 作为 spec content。
 * id = 相对 specRootDir 的路径去 .md 后缀，分隔符统一为 /。
 */
function parseSpecFile(filePath: string, specRootDir: string): Spec | null {
  const raw = readFileSync(filePath, 'utf8');
  const { frontMatter, body } = splitFrontMatter(raw);
  // id：相对路径，去 .md 后缀，分隔符统一为 /
  const relPath = relative(specRootDir, filePath)
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '');
  if (!relPath) {
    return null;
  }
  const description = typeof frontMatter.description === 'string' ? frontMatter.description : '';
  return {
    id: relPath,
    description,
    content: body.trim(),
    sourceFile: filePath,
  };
}

interface ParsedFrontMatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * 简易 YAML front-matter 解析：支持 `key: value` 与 `key: >`（折叠多行）。
 * 与 skills.ts 中的实现一致，不引入额外依赖。
 */
function splitFrontMatter(raw: string): { frontMatter: ParsedFrontMatter; body: string } {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontMatter: {}, body: raw };
  }
  const fmText = fmMatch[1];
  const body = fmMatch[2] ?? '';
  const fm: ParsedFrontMatter = {};
  const lines = fmText.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 跳过空行与注释
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let value = m[2];
    // 折叠多行 `key: >`
    if (value.trim() === '>' || value.trim() === '|') {
      const folded: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        // 缩进 2 空格视为续行
        if (next.startsWith('  ') || next.startsWith('\t')) {
          folded.push(next.replace(/^  /, ''));
          i++;
        } else {
          break;
        }
      }
      value = folded.join(' ').trim();
    } else {
      i++;
    }
    // 去除字符串两端引号
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return { frontMatter: fm, body };
}

/** 启动 fs.watch 递归监听用户 spec 目录，实现热重载 */
async function startWatch(
  reg: SpecRegistry,
  dir: string,
  logger: Logger,
  eventBus: EventBus,
): Promise<void> {
  try {
    await stat(dir);
  } catch {
    // 目录不存在，跳过监听
    return;
  }
  let watcher: FSWatcher;
  try {
    // recursive: true 递归监听子目录（Bun 跨平台支持）
    watcher = watch(dir, { recursive: true });
  } catch (err) {
    logger.debug(t('tools.specDirWatchUnavailable'), {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  /** 资源变更通知：广播给订阅方（前端 WS 刷新等） */
  function notify(id: string): void {
    void eventBus.broadcast('resources:changed', { kind: 'spec', id });
  }
  watcher.on('change', (eventType: string, filename: string | Buffer | null) => {
    if (filename === null || Buffer.isBuffer(filename)) return;
    const name: string = filename;
    // 只关心 .md 文件
    if (!name.endsWith('.md')) return;
    const full = join(dir, name);
    if (eventType === 'rename') {
      // 文件被删除或创建
      stat(full)
        .then(s => {
          if (s.isFile()) {
            // 创建/重命名进入
            try {
              const spec = parseSpecFile(full, dir);
              if (spec) {
                reg.reloadBySourceFile(full, spec);
                logger.info(t('tools.specReloaded', { id: spec.id }), { file: full });
                notify(spec.id);
              }
            } catch (err) {
              logger.warn(t('tools.reloadSpecFailed', { file: full }), {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } else {
            reg.removeBySourceFile(full);
            logger.info(t('tools.specRemoved', { file: full }));
            notify(name.replace(/\.md$/i, ''));
          }
        })
        .catch(() => {
          // 文件已不存在
          reg.removeBySourceFile(full);
          logger.info(t('tools.specRemoved', { file: full }));
          notify(name.replace(/\.md$/i, ''));
        });
    } else if (eventType === 'change') {
      // 文件内容变更
      try {
        const spec = parseSpecFile(full, dir);
        if (spec) {
          reg.reloadBySourceFile(full, spec);
          logger.info(t('tools.specReloaded', { id: spec.id }), { file: full });
          notify(spec.id);
        }
      } catch (err) {
        logger.warn(t('tools.reloadSpecFailed', { file: full }), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
}

// ============================================================================
// 同步 fs 操作封装（避免在初始化路径中引入异步复杂性）
// ============================================================================
// Bun 与 Node 均提供同步 API；这里通过 require 拿到 node:fs 的同步版本。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeFs = require('node:fs') as any;

function readdirSync(dir: string): string[] {
  return nodeFs.readdirSync(dir) as string[];
}

function statSync(path: string): { isDirectory(): boolean; isFile(): boolean } {
  return nodeFs.statSync(path) as { isDirectory(): boolean; isFile(): boolean };
}

function readFileSync(path: string, encoding: string): string {
  return nodeFs.readFileSync(path, encoding) as string;
}
