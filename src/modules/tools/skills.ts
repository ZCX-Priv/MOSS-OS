// src/modules/tools/skills.ts
// Skill 注册表：仅从 ~/.moss/skills/ 动态加载 .md 文件（YAML front-matter + Markdown body）。
// 首次启动时从包内 skills/ 播种内置模板到 ~/.moss/skills/（仅当目标目录不存在时）。
// 支持热重载：监听用户 skills 目录变更，自动增删 skill。

import { t } from '../../core/i18n';
import { stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Environment, EventBus, Logger } from '../../core/types';
import { ServiceNames } from '../../core/types';

/** 旧常量保留，值等于 ServiceNames.SKILL_REGISTRY，向后兼容 */
export const SKILL_REGISTRY_SERVICE = ServiceNames.SKILL_REGISTRY;

export interface Skill {
  name: string;
  description: string;
  /** 调用此 skill 时返回的 prompt 文本（可能含 {{placeholder}} 占位符） */
  prompt: string;
  /** 来源文件绝对路径（用于热重载定位） */
  sourceFile?: string;
}

export interface SkillRegistry {
  register(skill: Skill): void;
  unregister(name: string): void;
  get(name: string): Skill | null;
  list(): Skill[];
  /**
   * 替换某个来源文件对应的 skill（热重载用）。
   * 若新 skill 的 name 与已注册的同名 skill 冲突但 sourceFile 不同，则跳过（旧优先）。
   */
  reloadBySourceFile(sourceFile: string, skill: Skill): void;
  /** 移除指定来源文件对应的 skill（文件删除时调用） */
  removeBySourceFile(sourceFile: string): void;
}

class SkillRegistryImpl implements SkillRegistry {
  private readonly skills = new Map<string, Skill>();
  /** sourceFile -> skill name 索引（热重载定位用） */
  private readonly fileIndex = new Map<string, string>();

  register(skill: Skill): void {
    const existing = this.skills.get(skill.name);
    if (existing?.sourceFile) {
      this.fileIndex.delete(existing.sourceFile);
    }
    this.skills.set(skill.name, skill);
    if (skill.sourceFile) {
      this.fileIndex.set(skill.sourceFile, skill.name);
    }
  }

  unregister(name: string): void {
    const existing = this.skills.get(name);
    if (existing?.sourceFile) {
      this.fileIndex.delete(existing.sourceFile);
    }
    this.skills.delete(name);
  }

  get(name: string): Skill | null {
    return this.skills.get(name) ?? null;
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  reloadBySourceFile(sourceFile: string, skill: Skill): void {
    const oldName = this.fileIndex.get(sourceFile);
    // 若文件曾注册过且 name 变了，先移除旧的
    if (oldName && oldName !== skill.name) {
      this.skills.delete(oldName);
      this.fileIndex.delete(sourceFile);
    }
    // 同名 skill 若已被其他来源占用，保留先注册的
    const existing = this.skills.get(skill.name);
    if (existing && existing.sourceFile !== sourceFile) {
      // 名称冲突，跳过（先注册者优先）
      return;
    }
    this.skills.set(skill.name, skill);
    this.fileIndex.set(sourceFile, skill.name);
  }

  removeBySourceFile(sourceFile: string): void {
    const name = this.fileIndex.get(sourceFile);
    if (name) {
      this.skills.delete(name);
      this.fileIndex.delete(sourceFile);
    }
  }
}

/**
 * 首次启动播种：若 ~/.moss/skills 不存在，从内置目录复制所有 .md 文件。
 * 仅当目标目录不存在时执行，用户删除的 skill 不会被重新添加。
 * 播种失败不阻断启动，仅记录日志。
 */
function seedBuiltinSkills(builtinDir: string, userDir: string, logger: Logger): void {
  try {
    // 目录已存在则跳过（用户已初始化过，不覆盖其修改/删除）
    try {
      nodeFs.statSync(userDir);
      return;
    } catch {
      // 目录不存在，继续播种
    }
    const entries = readdirSync(builtinDir); // 内置目录不存在会抛错被外层 catch
    nodeFs.mkdirSync(userDir, { recursive: true });
    let count = 0;
    for (const file of entries) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = readFileSync(join(builtinDir, file), 'utf8');
        nodeFs.writeFileSync(join(userDir, file), content, 'utf8');
        count++;
      } catch (err) {
        logger.warn(t('tools.seedSkillFailed', { file }), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info(t('tools.seededSkills', { dir: userDir }), { count });
  } catch (err) {
    // 内置目录不存在（开发模式异常）或 mkdir 失败
    logger.warn(t('tools.seedBuiltinSkillsFailed'), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 创建 Skill 注册表：仅从用户 ~/.moss/skills/ 加载 .md 文件。
 * 首次启动时从包内 skills/ 播种内置模板到 ~/.moss/skills/。
 * 监听用户目录变更实现热重载。
 */
export function createSkillRegistry(
  env: Environment,
  logger: Logger,
  eventBus: EventBus,
): SkillRegistry {
  const reg = new SkillRegistryImpl();
  const builtinDir = join(env.packageRoot, 'skills');  // 仅作种子源
  const userDir = join(env.dataDir, 'skills');         // 唯一加载源

  // 首次启动播种：若 ~/.moss/skills 不存在，从内置目录复制 .md 文件
  seedBuiltinSkills(builtinDir, userDir, logger);

  // 同步加载（仅从用户目录）
  loadSkillsFromDirSync(reg, userDir, logger);

  // 启动热重载监听（异步，不阻塞初始化）
  startWatch(reg, userDir, logger, eventBus).catch(err => {
    logger.debug(t('tools.skillWatchFailed'), {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return reg;
}

/** 同步从目录加载所有 .md skill 文件 */
function loadSkillsFromDirSync(reg: SkillRegistry, dir: string, logger: Logger): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const full = join(dir, file);
    try {
      const skill = parseSkillFile(full);
      if (skill) {
        reg.reloadBySourceFile(full, skill);
      }
    } catch (err) {
      logger.warn(t('tools.loadSkillFailed', { file: full }), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * 解析 skill .md 文件：YAML front-matter + Markdown body。
 * front-matter 必须含 name（必填）和 description（可选）。
 * body 作为 prompt 文本。
 */
function parseSkillFile(filePath: string): Skill | null {
  // 使用同步读取以避免异步初始化复杂性
  const raw = readFileSync(filePath, 'utf8');
  const { frontMatter, body } = splitFrontMatter(raw);
  const name = frontMatter.name;
  if (!name || typeof name !== 'string') {
    return null;
  }
  const description = typeof frontMatter.description === 'string' ? frontMatter.description : '';
  return {
    name,
    description,
    prompt: body.trim(),
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
 * 不引入额外依赖（js-yaml 等），仅支持 skill 文档所需的子集。
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

/** 启动 fs.watch 监听用户 skills 目录，实现热重载 */
async function startWatch(
  reg: SkillRegistry,
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
    watcher = watch(dir, { recursive: false });
  } catch (err) {
    logger.debug(t('tools.skillDirWatchUnavailable'), {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  /** 资源变更通知：广播给订阅方（前端 WS 刷新等） */
  function notify(name: string): void {
    void eventBus.broadcast('resources:changed', { kind: 'skill', name });
  }
  watcher.on('change', (eventType: string, filename: string | Buffer | null) => {
    if (filename === null || Buffer.isBuffer(filename)) return;
    const name: string = filename;
    if (!name.endsWith('.md')) return;
    const full = join(dir, name);
    if (eventType === 'rename') {
      // 文件被删除或创建
      stat(full)
        .then(s => {
          if (s.isFile()) {
            // 创建/重命名进入
            try {
              const skill = parseSkillFile(full);
              if (skill) {
                reg.reloadBySourceFile(full, skill);
                logger.info(t('tools.skillReloaded', { name: skill.name }), { file: full });
                notify(skill.name);
              }
            } catch (err) {
              logger.warn(t('tools.reloadSkillFailed', { file: full }), {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } else {
            reg.removeBySourceFile(full);
            logger.info(t('tools.skillRemoved', { file: full }));
            notify(name.replace(/\.md$/i, ''));
          }
        })
        .catch(() => {
          // 文件已不存在
          reg.removeBySourceFile(full);
          logger.info(t('tools.skillRemoved', { file: full }));
          notify(name.replace(/\.md$/i, ''));
        });
    } else if (eventType === 'change') {
      // 文件内容变更
      try {
        const skill = parseSkillFile(full);
        if (skill) {
          reg.reloadBySourceFile(full, skill);
          logger.info(t('tools.skillReloaded', { name: skill.name }), { file: full });
          notify(skill.name);
        }
      } catch (err) {
        logger.warn(t('tools.reloadSkillFailed', { file: full }), {
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
const nodeFs = (require('node:fs') as any);

function readdirSync(dir: string): string[] {
  return nodeFs.readdirSync(dir) as string[];
}

function readFileSync(path: string, encoding: string): string {
  return nodeFs.readFileSync(path, encoding) as string;
}
