// src/modules/tools/manifest.ts
// 工具配置规格单一真相源。
// 从 builtin 目录的 tool.json 动态加载每个工具的 config 段，构建 Zod schema + 默认值。
// 此文件只读取 JSON（不 import 任何工具实例代码），确保 config 加载不依赖工具代码。
// config-service 只依赖此文件，工具代码加载失败不影响 config 加载。

import { z } from 'zod';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ToolConfigSpec {
  /** 该工具配置字段的 Zod schema（不含 .default()） */
  schema: z.ZodObject<z.ZodRawShape>;
  /** 默认值（与 schema 匹配） */
  defaults: Record<string, unknown>;
}

/** tool.json 的 config.schema 简化字段类型描述 */
interface ConfigFieldSchema {
  type: 'boolean' | 'integer' | 'string';
  min?: number;
  max?: number;
}

/** tool.json 的 config 段 */
interface ToolConfigManifest {
  defaults: Record<string, unknown>;
  schema?: Record<string, ConfigFieldSchema>;
}

/**
 * 探测内置工具目录（manifest 专用，不依赖 env）。
 * 候选路径：
 *   - import.meta.dir/builtin            （开发模式：manifest.ts 在 src/modules/tools/）
 *   - import.meta.dir/modules/tools/builtin（生产模式：server.js 在 dist/，builtin 复制到 dist/modules/tools/builtin）
 */
function resolveBuiltinConfigDir(): string | null {
  const candidates = [
    join(import.meta.dir, 'builtin'),
    join(import.meta.dir, 'modules', 'tools', 'builtin'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * 扫描目录下所有 tool.json，构建 toolName → ToolConfigSpec 映射。
 * 纯 JSON 读取，不 import 工具代码。
 */
function loadToolConfigsFromDir(dir: string): Map<string, ToolConfigSpec> {
  const result = new Map<string, ToolConfigSpec>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(full, 'tool.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw) as { name?: string; config?: ToolConfigManifest };
      if (!manifest.name || !manifest.config) continue;
      const spec = buildConfigSpec(manifest.config);
      result.set(manifest.name, spec);
    } catch {
      // 无效的 tool.json，跳过
    }
  }
  return result;
}

/**
 * 从 tool.json 的 config 段构建 ToolConfigSpec。
 * - enabled 字段自动识别为 boolean（所有工具都有）
 * - 其他字段从 config.schema 获取约束，或从 defaults 值类型推断
 */
function buildConfigSpec(config: ToolConfigManifest): ToolConfigSpec {
  const shape: z.ZodRawShape = {};
  // enabled 自动注入（所有工具都有）
  shape.enabled = z.boolean();

  for (const [key, val] of Object.entries(config.defaults)) {
    if (key === 'enabled') continue;
    const fieldSchema = config.schema?.[key];
    if (fieldSchema) {
      shape[key] = buildZodField(fieldSchema);
    } else {
      shape[key] = inferZodFromValue(val);
    }
  }

  return {
    schema: z.object(shape),
    defaults: { ...config.defaults },
  };
}

/** 把简化 JSON 类型描述转为 Zod */
function buildZodField(field: ConfigFieldSchema): z.ZodTypeAny {
  switch (field.type) {
    case 'boolean':
      return z.boolean();
    case 'integer': {
      let s = z.number().int();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      return s;
    }
    case 'string':
      return z.string();
    default:
      return z.unknown();
  }
}

/** 无 schema 声明时，按 defaults 值类型推断 Zod */
function inferZodFromValue(val: unknown): z.ZodTypeAny {
  if (typeof val === 'boolean') return z.boolean();
  if (typeof val === 'number') return z.number();
  if (typeof val === 'string') return z.string();
  return z.unknown();
}

// ============================================================================
// 模块加载时立即扫描 builtin 目录（顶层执行，同步读 JSON）
// ============================================================================
const BUILTIN_DIR = resolveBuiltinConfigDir();
if (!BUILTIN_DIR) {
  // 不阻断启动，但提示开发者 builtin 目录缺失（config 会回退到空 tools schema）
  console.warn('[manifest] builtin tools directory not found, tools config will be empty');
}
const TOOL_CONFIGS: Map<string, ToolConfigSpec> = BUILTIN_DIR
  ? loadToolConfigsFromDir(BUILTIN_DIR)
  : new Map();

/**
 * 构建 tools Zod schema。
 * 每个字段加 .default()，缺失时自动补全默认值。
 * 用 passthrough() 允许额外字段（自定义工具的配置），不会因 config.json
 * 包含未知工具字段而校验失败。
 */
export function buildToolsSchema() {
  const shape: z.ZodRawShape = {};
  for (const [name, spec] of TOOL_CONFIGS) {
    shape[name] = spec.schema.default(spec.defaults);
  }
  return z.object(shape).passthrough();
}

/** 构建 tools 默认值（用于 defaultAppConfig 和 loadDefaults） */
export function buildToolsDefaults(): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, spec] of TOOL_CONFIGS) {
    result[name] = { ...spec.defaults };
  }
  return result;
}

/** 内置工具名集合（用于区分内置与自定义工具，防止自定义工具覆盖内置工具） */
export const BUILTIN_TOOL_NAMES = new Set(TOOL_CONFIGS.keys());

/** 从 schema 推导 ToolsConfig 类型，保持类型与 schema 永远一致 */
export type ToolsConfig = z.infer<ReturnType<typeof buildToolsSchema>>;
