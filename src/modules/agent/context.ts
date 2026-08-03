// src/modules/agent/context.ts
// 系统提示词构建 + 工具描述注入。
// 系统提示词从 agent/prompts/main/ 下的 md 文件按序拼接：
//   system/soul → base/identity → rule/rules → 其他 *.md（字母序）
// 用户目录（~/.moss/agent/prompts/main/）同名覆盖包内。
// 全部缺失则回退 FALLBACK_SYSTEM_PROMPT。
// 末尾追加规范引导段落，告知 agent 可用 list_spec/get_spec 按需读取规范。

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { release, hostname, arch, cpus } from 'node:os';
import type { UnifiedTool } from '../llm/types';
import type { ToolRegistry } from '../contracts';
import type { Environment, Platform } from '../../core/types';

/** 兜底系统提示词：当 agent/prompts/main/ 下无任何基本设定文件时使用 */
const FALLBACK_SYSTEM_PROMPT = `你是 MOSS-OS，一个运行在真实环境中的交互式 AI 智能体。

你可以使用工具读写文件、执行命令、调用 skill、调用 MCP 服务器，并按需读取规范文档。

# 核心原则
1. **第一性原理**：从根本推理，不浮于表面。
2. **诚实**：不编造，有依据，不懂坦白。
3. **最小改动**：只做被要求的事，不擅自重构、加文档或加功能。
4. **安全优先**：破坏性操作需明确确认。
5. **工具纪律**：声称环境事实前先用工具核实。

# 工作目录
你相对用户的工作目录操作。用 \`read\` 查看文件，\`shell\` 运行命令，\`edit\` 精确编辑，\`write\` 新建文件。

# 响应格式
- 简洁直接，先给答案或行动，不铺垫推理。
- 使用工具时简述在做什么及为什么。
- 工具执行后总结结果并继续。

# 环境
- 平台：{{PLATFORM}}
- 工作目录：{{CWD}}`;

/** 规范引导段落：告知 agent 如何按需读取 spec 规范文件 */
const SPEC_GUIDE_SECTION = `# 规范

你可以通过两个工具按需读取规范文档：
- \`list_spec\`：列出所有可用的规范文件（树形视图，含描述）。
- \`get_spec\`：按 id 读取某个规范的完整内容。

规范文件位于 \`agent/prompts/main/spec/\`，可按子目录组织。
spec id 为相对路径去掉 \`.md\` 扩展名（如 "coding/typescript"）。
先用 \`list_spec\` 发现可用规范，再用 \`get_spec\` 读取与当前任务相关的规范。
不要读取不需要的规范。`;

/** 基本设定候选文件名（不含 .md），按拼接优先级排序；每个位置取第一个存在的文件 */
const BASE_PROMPT_CANDIDATES: ReadonlyArray<ReadonlyArray<string>> = [
  ['system', 'soul'],
  ['base', 'identity'],
  ['rule', 'rules'],
];

/** 候选文件名集合（用于排除「其他」文件） */
const CANDIDATE_NAMES: ReadonlySet<string> = new Set<string>(
  BASE_PROMPT_CANDIDATES.flat(),
);

/**
 * 从 agent/prompts/main/ 加载基本设定并按序拼接。
 * 顺序：system/soul → base/identity → rule/rules → 其他 *.md（字母序）。
 * 用户目录同名覆盖包内。全部缺失则返回 FALLBACK_SYSTEM_PROMPT。
 */
function loadBasePrompt(env: Environment): string {
  const builtinDir = join(env.packageRoot, 'agent', 'prompts', 'main');
  const userDir = join(env.dataDir, 'agent', 'prompts', 'main');

  const segments: string[] = [];

  // 1. 按候选顺序加载每个位置
  for (const candidates of BASE_PROMPT_CANDIDATES) {
    const content = readFirstExisting(candidates, builtinDir, userDir);
    if (content !== null) {
      segments.push(content.trim());
    }
  }

  // 2. 收集「其他」*.md（不在候选名中），按字母序
  const others = collectOtherFiles(builtinDir, userDir);
  for (const content of others) {
    segments.push(content.trim());
  }

  if (segments.length === 0) {
    return FALLBACK_SYSTEM_PROMPT;
  }
  return segments.join('\n\n---\n\n');
}

/** 在候选名中查找第一个存在的文件，用户目录优先覆盖包内 */
function readFirstExisting(
  candidates: ReadonlyArray<string>,
  builtinDir: string,
  userDir: string,
): string | null {
  for (const name of candidates) {
    const userFile = join(userDir, `${name}.md`);
    if (fileExists(userFile)) {
      return readFile(userFile);
    }
    const builtinFile = join(builtinDir, `${name}.md`);
    if (fileExists(builtinFile)) {
      return readFile(builtinFile);
    }
  }
  return null;
}

/** 收集两个目录下不在候选名中的 *.md（用户目录优先覆盖同名），按字母序返回内容 */
function collectOtherFiles(builtinDir: string, userDir: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  // 先扫描用户目录，再扫描包内；同名只取先出现的（用户优先）
  for (const dir of [userDir, builtinDir]) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const baseName = entry.replace(/\.md$/i, '');
      if (CANDIDATE_NAMES.has(baseName)) continue;
      if (seen.has(baseName)) continue;
      seen.add(baseName);
      names.push(entry);
    }
  }

  names.sort((a, b) => a.localeCompare(b));

  const result: string[] = [];
  for (const entry of names) {
    const userFile = join(userDir, entry);
    if (fileExists(userFile)) {
      result.push(readFile(userFile));
      continue;
    }
    const builtinFile = join(builtinDir, entry);
    if (fileExists(builtinFile)) {
      result.push(readFile(builtinFile));
    }
  }
  return result;
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function readFile(path: string): string {
  // 读取后剥离 UTF-8 BOM，避免 \uFEFF 注入系统提示
  const raw = readFileSync(path, 'utf8');
  return raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
}

/** 平台名转为可读名称 */
function prettyPlatform(p: Platform): string {
  switch (p) {
    case 'win32': return 'Windows';
    case 'darwin': return 'macOS';
    case 'linux': return 'Linux';
    default: return 'Other';
  }
}

/**
 * 收集系统提示词中可替换的变量。
 * 支持：{{PLATFORM}} {{CWD}}（向后兼容大写）及用户指定的 10 个小写变量。
 * battery_level 固定为 "unknown"（不做平台探测）。
 */
function collectPromptVars(
  env: Environment,
  cwd: string,
  model: string,
  modelDisplayName: string,
): Record<string, string> {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  let locale = 'unknown';
  let timezone = 'unknown';
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    locale = resolved.locale ?? locale;
    timezone = resolved.timeZone ?? timezone;
  } catch {
    // 极少数环境 Intl 不可用，保留 unknown
  }

  let cpuModel = 'unknown';
  try {
    cpuModel = cpus()[0]?.model ?? cpuModel;
  } catch {
    // 忽略
  }

  return {
    PLATFORM: env.platform,
    CWD: cwd,
    cur_date: date,
    cur_time: time,
    cur_datetime: `${date} ${time}`,
    model_id: model,
    model_name: modelDisplayName,
    locale,
    timezone,
    system_version: `${prettyPlatform(env.platform)} ${release()}`,
    device_info: `${hostname()} / ${arch()} / ${cpuModel}`,
    battery_level: 'unknown',
  };
}

/**
 * 构建系统提示词：基本设定（文件加载）+ 规范引导段落，替换所有占位符变量。
 * 用全局正则一次性替换所有 {{var}}，未识别的变量保持原样。
 */
export function buildSystemPrompt(
  env: Environment,
  cwd: string,
  model?: string,
  modelDisplayName?: string,
): string {
  const base = loadBasePrompt(env);
  const vars = collectPromptVars(
    env,
    cwd,
    model ?? 'unknown',
    modelDisplayName ?? model ?? 'unknown',
  );
  return (base + '\n\n---\n\n' + SPEC_GUIDE_SECTION).replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/**
 * 把 ToolRegistry 中的工具 schema 转换为 UnifiedTool 数组，供 LLM 注入。
 * 同时注入 MCP 工具（若 MCPManager 已注册）。
 */
export function buildTools(
  toolRegistry: ToolRegistry | null,
  mcpTools?: Array<{ server: string; name: string; description?: string; inputSchema?: unknown }>,
): UnifiedTool[] {
  const tools: UnifiedTool[] = [];

  // 内置工具
  if (toolRegistry) {
    for (const t of toolRegistry.listSchemas()) {
      tools.push({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      });
    }
  }

  // MCP 工具（用 mcp__server__tool 前缀，避免命名冲突）
  if (mcpTools) {
    for (const t of mcpTools) {
      const toolName = `mcp__${t.server}__${t.name}`;
      tools.push({
        type: 'function',
        function: {
          name: toolName,
          description: `[MCP:${t.server}] ${t.description ?? t.name}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
        },
      });
    }
  }

  return tools;
}

/** 把 tools 列表转为人类可读描述（用于无工具调用能力的 provider） */
export function describeTools(tools: UnifiedTool[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map(t => `- ${t.function.name}: ${t.function.description}`);
  return '\n\n# Available Tools\n' + lines.join('\n');
}
