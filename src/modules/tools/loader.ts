// src/modules/tools/loader.ts
// 统一工具加载器：从目录加载「tool.json + index.ts」结构的工具。
// 内置工具与自定义工具共用此加载器，仅目录来源不同。
// 支持两种 index.ts 导出形式：
//   - 静态：export default { execute: async (params, ctx) => {...} }
//   - 工厂：export default function createExecute(env) { return { execute: ... } }

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Environment, Logger } from '../../core/types';
import type { Tool, ToolAnnotations, JSONSchema } from './types';

/** tool.json 的 config.schema 简化字段类型描述 */
export interface ConfigFieldSchema {
  type: 'boolean' | 'integer' | 'string';
  min?: number;
  max?: number;
}

/** tool.json 的 config 段 */
export interface ToolConfigManifest {
  defaults: Record<string, unknown>;
  schema?: Record<string, ConfigFieldSchema>;
}

/** tool.json 的完整结构 */
export interface ToolManifest {
  name: string;
  description: string;
  icon?: string;
  annotations?: ToolAnnotations;
  inputSchema: JSONSchema;
  config?: ToolConfigManifest;
}

/** index.ts 默认导出的两种形式 */
interface ToolExecuteImpl {
  execute: Tool['execute'];
}
type ToolExport = ToolExecuteImpl | ((env: Environment) => ToolExecuteImpl);

/**
 * 从单个目录加载工具（tool.json + index.ts）。
 * 失败返回 null 并记录日志（错误隔离）。
 * @param dir 工具目录绝对路径
 * @param env 运行环境（工厂模式工具需要）
 * @param logger 日志
 * @param source 来源标记
 */
export async function loadToolFromDir(
  dir: string,
  env: Environment,
  logger: Logger,
  source: 'builtin' | 'custom',
): Promise<Tool | null> {
  const manifestPath = join(dir, 'tool.json');
  const indexPath = join(dir, 'index.ts');

  // 1. 读取并校验 tool.json
  if (!existsSync(manifestPath)) {
    logger.warn(`Tool dir skipped (no tool.json): ${dir}`);
    return null;
  }

  let manifest: ToolManifest;
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(raw) as ToolManifest;
  } catch (err) {
    logger.warn(`Tool dir skipped (invalid tool.json): ${dir}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!isValidManifest(manifest)) {
    logger.warn(`Tool dir skipped (tool.json missing required fields): ${dir}`);
    return null;
  }

  // 2. 动态 import index.ts
  let mod: { default?: ToolExport };
  try {
    mod = await import(indexPath);
  } catch (err) {
    logger.warn(`Tool dir skipped (failed to import index.ts): ${dir}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const exported = mod.default;
  if (!exported) {
    logger.warn(`Tool dir skipped (index.ts has no default export): ${dir}`);
    return null;
  }

  // 3. 解析导出形式（静态对象 or 工厂函数）
  let impl: ToolExecuteImpl;
  try {
    if (typeof exported === 'function') {
      impl = (exported as (env: Environment) => ToolExecuteImpl)(env);
    } else if (exported && typeof exported === 'object') {
      impl = exported as ToolExecuteImpl;
    } else {
      logger.warn(`Tool dir skipped (invalid export shape): ${dir}`);
      return null;
    }
  } catch (err) {
    logger.warn(`Tool factory invocation failed: ${dir}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!impl || typeof impl.execute !== 'function') {
    logger.warn(`Tool dir skipped (no execute function): ${dir}`);
    return null;
  }

  // 4. 合并 tool.json 静态字段 + index.ts 的 execute，注入 sourceDir/source
  const tool: Tool = {
    name: manifest.name,
    description: manifest.description,
    inputSchema: manifest.inputSchema,
    annotations: manifest.annotations,
    icon: manifest.icon,
    execute: impl.execute,
    sourceDir: dir,
    source,
  };

  return tool;
}

/**
 * 批量加载目录下所有工具（每个子目录一个工具）。
 * 错误隔离：单个工具加载失败不影响其他。
 */
export async function loadToolsFromDir(
  dir: string,
  env: Environment,
  logger: Logger,
  source: 'builtin' | 'custom',
): Promise<Tool[]> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const tools: Tool[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const tool = await loadToolFromDir(full, env, logger, source);
    if (tool) tools.push(tool);
  }
  return tools;
}

/**
 * 探测内置工具目录：优先 src/modules/tools/builtin，回退 dist/modules/tools/builtin。
 * 与 extension-manager 的双路径扫描模式一致。
 */
export function resolveBuiltinDir(env: Environment): string | null {
  const candidates = [
    join(env.packageRoot, 'src', 'modules', 'tools', 'builtin'),
    join(env.packageRoot, 'dist', 'modules', 'tools', 'builtin'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** 校验 tool.json 必填字段 */
function isValidManifest(obj: unknown): obj is ToolManifest {
  if (!obj || typeof obj !== 'object') return false;
  const m = obj as Record<string, unknown>;
  return (
    typeof m.name === 'string' &&
    typeof m.description === 'string' &&
    typeof m.inputSchema === 'object' &&
    m.inputSchema !== null
  );
}
