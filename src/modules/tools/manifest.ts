// src/modules/tools/manifest.ts
// 工具配置规格单一真相源。
// 此文件只包含 Zod schema + 默认值 + 类型推导，不 import 任何工具实例。
// config-service 只依赖此文件，工具代码加载失败不影响 config 加载。

import { z } from 'zod';

export interface ToolConfigSpec {
  /** 该工具配置字段的 Zod schema（不含 .default()） */
  schema: z.ZodObject<z.ZodRawShape>;
  /** 默认值（与 schema 匹配） */
  defaults: Record<string, unknown>;
}

/**
 * 所有内置工具的配置规格（单一真相源）。
 * 新增工具时在此处加一行配置规格，再到 builtin.ts 加一行 factory 即可。
 * config schema、类型、默认值、注册循环全部自动跟随。
 */
export const TOOL_CONFIGS: Record<string, ToolConfigSpec> = {
  read:      { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  write:     { schema: z.object({ enabled: z.boolean(), requireConfirmation: z.boolean() }), defaults: { enabled: true, requireConfirmation: true } },
  edit:      { schema: z.object({ enabled: z.boolean(), requireConfirmation: z.boolean() }), defaults: { enabled: true, requireConfirmation: false } },
  delete:    { schema: z.object({ enabled: z.boolean(), requireConfirmation: z.boolean() }), defaults: { enabled: true, requireConfirmation: true } },
  shell:     { schema: z.object({ enabled: z.boolean(), timeout: z.number().int().positive(), requireConfirmation: z.boolean() }), defaults: { enabled: true, timeout: 30000, requireConfirmation: true } },
  use_skill: { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  use_mcp:   { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  list_mcp:  { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  list_spec: { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  get_spec:  { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  glob:      { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  grep:      { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  todo:      { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
  ask:       { schema: z.object({ enabled: z.boolean() }), defaults: { enabled: true } },
};

/**
 * 构建 tools Zod schema。
 * 每个字段加 .default()，缺失时自动补全默认值。
 * 用 passthrough() 允许额外字段（自定义工具的配置），不会因 config.json
 * 包含未知工具字段而校验失败。
 */
export function buildToolsSchema() {
  const shape: z.ZodRawShape = {};
  for (const [name, spec] of Object.entries(TOOL_CONFIGS)) {
    shape[name] = spec.schema.default(spec.defaults);
  }
  return z.object(shape).passthrough();
}

/** 构建 tools 默认值（用于 defaultAppConfig 和 loadDefaults） */
export function buildToolsDefaults(): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, spec] of Object.entries(TOOL_CONFIGS)) {
    result[name] = { ...spec.defaults };
  }
  return result;
}

/** 内置工具名集合（用于区分内置与自定义工具，防止自定义工具覆盖内置工具） */
export const BUILTIN_TOOL_NAMES = new Set(Object.keys(TOOL_CONFIGS));

/** 从 schema 推导 ToolsConfig 类型，保持类型与 schema 永远一致 */
export type ToolsConfig = z.infer<ReturnType<typeof buildToolsSchema>>;
