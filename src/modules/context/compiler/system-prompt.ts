// src/modules/context/compiler/system-prompt.ts
// 静态系统提示组装（缓存对齐布局核心）：
// - 从 ~/.moss/agent/prompts/main/ 加载基本设定并按序拼接（soul → identity → rules → 其他 → 规范引导）
// - 只保留进程内静态变量（PLATFORM/CWD/model_id 等）；cur_time/cur_date 等动态变量
//   一律移出（移至 env-context 消息），保证 system prompt 字节级稳定 → 前缀缓存命中
// - mtime 缓存：文件未变不重复读盘；变更即进入新缓存周期
// 迁移自 agent/context.ts（loadBasePrompt/buildSystemPrompt），并输出分段结构
//（供 WebUI「系统」标签页折叠栏展示）。

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { release, hostname, arch, cpus } from 'node:os';
import type { Environment, Platform } from '../../../core/types';
import type { SystemSection } from '../types';
import { seedBuiltinAgentPrompts } from '../../tools/shared/agent-seed';
import { SYSTEM_SCOPE } from '../../filesys/roots';
import { estimateTextTokens } from '../budgeter/estimator';

/** 兜底系统提示词（agent/prompts/main/ 下无任何基本设定文件时） */
export const FALLBACK_SYSTEM_PROMPT = `你是 MOSS，一个运行在真实环境中的交互式 AI 智能体。

你可以使用工具读写文件、执行命令、调用 skill、调用 MCP 服务器，并按需读取规范文档。

# 核心原则
1. **第一性原理**：从根本推理，不浮于表面。
2. **诚实**：不编造，有依据，不懂坦白。
3. **最小改动**：只做被要求的事，不擅自重构、加文档或加功能。
4. **安全优先**：破坏性操作需明确确认。
5. **工具纪律**：声称环境事实前先用工具核实。

# 响应格式
- 简洁直接，先给答案或行动，不铺垫推理。
- 使用工具时简述在做什么及为什么。
- 工具执行后总结结果并继续。`;

/** 规范引导段落：告知 agent 如何按需读取 spec 规范文件 */
export const SPEC_GUIDE_SECTION = `# 规范

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

const CANDIDATE_NAMES: ReadonlySet<string> = new Set<string>(BASE_PROMPT_CANDIDATES.flat());

/** 段落标题（WebUI 系统标签页折叠栏展示用） */
const SEGMENT_TITLES: Record<string, string> = {
  soul: '工作哲学（soul）',
  identity: '身份认知（identity）',
  rules: '行为规则（rules）',
  'spec-guide': '规范引导（spec guide）',
  fallback: '基础设定（内置兜底）',
};

/** 段落缓存条目：mtime 未变时免读盘 */
interface PromptCacheEntry {
  key: string;
  mtimeMs: number;
  segments: SystemSection[];
  joined: string;
}

let promptCache: PromptCacheEntry | null = null;

function prettyPlatform(p: Platform): string {
  switch (p) {
    case 'win32': return 'Windows';
    case 'darwin': return 'macOS';
    case 'linux': return 'Linux';
    default: return 'Other';
  }
}

function readFileNoBom(path: string): string {
  const raw = readFileSync(path, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * 收集系统提示词的静态变量（进程内不变；动态时间变量已移至 env-context 消息）。
 */
function collectStaticPromptVars(
  env: Environment,
  cwd: string,
  model: string,
  modelDisplayName: string,
): Record<string, string> {
  let locale = 'unknown';
  let timezone = 'unknown';
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    locale = resolved.locale ?? locale;
    timezone = resolved.timeZone ?? timezone;
  } catch {
    // 极少数环境 Intl 不可用
  }

  let cpuModel = 'unknown';
  try {
    cpuModel = cpus()[0]?.model ?? cpuModel;
  } catch {
    // 忽略
  }

  return {
    PLATFORM: prettyPlatform(env.platform),
    CWD:
      cwd === SYSTEM_SCOPE
        ? `System-wide access mode (full filesystem access; default working directory: ${env.homeDir}; under ~/.moss only the agent/, mcps/, skills/ subdirectories are accessible)`
        : cwd,
    model_id: model,
    model_name: modelDisplayName,
    locale,
    timezone,
    system_version: `${prettyPlatform(env.platform)} ${release()}`,
    device_info: `${hostname()} / ${arch()} / ${cpuModel}`,
  };
}

/** 应用静态变量替换（未识别的 {{var}} 保持原样） */
function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/** 主提示词目录的 mtime 指纹（目录 + 候选文件；变更即缓存失效） */
function promptDirMtime(userDir: string): number {
  let max = 0;
  try {
    max = Math.max(max, statSync(userDir).mtimeMs);
  } catch {
    return -1;
  }
  for (const name of readdirSync(userDir)) {
    if (!name.endsWith('.md')) continue;
    try {
      max = Math.max(max, statSync(join(userDir, name)).mtimeMs);
    } catch {
      // 单文件失败忽略
    }
  }
  return max;
}

/**
 * 加载系统提示词分段（带 mtime 缓存）。
 * 顺序：system/soul → base/identity → rule/rules → 其他 *.md（字母序）→ 规范引导。
 */
export function loadSystemPromptSegments(env: Environment): SystemSection[] {
  seedBuiltinAgentPrompts(env);
  const userDir = join(env.dataDir, 'agent', 'prompts', 'main');
  const cacheKey = userDir;
  const mtime = promptDirMtime(userDir);
  if (promptCache && promptCache.key === cacheKey && promptCache.mtimeMs === mtime) {
    return promptCache.segments;
  }

  const segments: SystemSection[] = [];

  // 1. 候选位置
  for (const candidates of BASE_PROMPT_CANDIDATES) {
    for (const name of candidates) {
      const file = join(userDir, `${name}.md`);
      if (fileExists(file)) {
        segments.push({
          id: name,
          title: SEGMENT_TITLES[name] ?? name,
          tokens: 0,
          content: readFileNoBom(file).trim(),
        });
        break;
      }
    }
  }

  // 2. 其他 *.md（字母序）
  let others: string[] = [];
  try {
    others = readdirSync(userDir)
      .filter(e => e.endsWith('.md'))
      .map(e => e.replace(/\.md$/i, ''))
      .filter(baseName => !CANDIDATE_NAMES.has(baseName))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    others = [];
  }
  for (const baseName of others) {
    const file = join(userDir, `${baseName}.md`);
    if (fileExists(file)) {
      segments.push({
        id: baseName,
        title: baseName,
        tokens: 0,
        content: readFileNoBom(file).trim(),
      });
    }
  }

  // 3. 全部缺失 → 内置兜底
  if (segments.length === 0) {
    segments.push({
      id: 'fallback',
      title: SEGMENT_TITLES.fallback,
      tokens: 0,
      content: FALLBACK_SYSTEM_PROMPT,
    });
  }

  // 4. 规范引导（固定段落，恒在末尾）
  segments.push({
    id: 'spec-guide',
    title: SEGMENT_TITLES['spec-guide'],
    tokens: 0,
    content: SPEC_GUIDE_SECTION,
    defaultOpen: false,
  });

  promptCache = { key: cacheKey, mtimeMs: mtime, segments, joined: segments.map(s => s.content).join('\n\n---\n\n') };
  return segments;
}

/**
 * 构建静态系统提示词（变量替换后拼接全文）。
 * 只含进程内静态变量 → 同一进程内跨轮字节级一致（前缀缓存锚点）。
 * @param skillPrompt 可选的 skill system 模式注入内容（拼接在末尾；skill 切换=新缓存周期，低频可接受）
 */
export function buildStaticSystemPrompt(
  env: Environment,
  cwd: string,
  model: string,
  modelDisplayName: string,
  skillPrompt?: string | null,
): string {
  seedBuiltinAgentPrompts(env);
  const userDir = join(env.dataDir, 'agent', 'prompts', 'main');
  const mtime = promptDirMtime(userDir);
  if (!(promptCache && promptCache.key === userDir && promptCache.mtimeMs === mtime)) {
    loadSystemPromptSegments(env);
  }
  const joined = promptCache?.joined ?? FALLBACK_SYSTEM_PROMPT;
  const vars = collectStaticPromptVars(env, cwd, model, modelDisplayName);
  let result = applyVars(joined, vars);
  if (skillPrompt) {
    result += `\n\n---\n\n${skillPrompt}`;
  }
  return result;
}

/**
 * 获取系统提示词分段（含 tokens 估算，WebUI 系统标签页数据源）。
 * @param skillName 当前活跃 skill 名（system 模式时追加该段）
 * @param resolveSkillPrompt skill 内容解析回调（从 SkillRegistry 实时解析）
 */
export function getSystemSections(
  env: Environment,
  cwd: string,
  model: string,
  modelDisplayName: string,
  skillName?: string,
  resolveSkillPrompt?: (name: string) => string | null,
): SystemSection[] {
  const vars = collectStaticPromptVars(env, cwd, model, modelDisplayName);
  const segments = loadSystemPromptSegments(env).map(s => ({
    ...s,
    content: applyVars(s.content, vars),
  }));
  if (skillName && resolveSkillPrompt) {
    const skillPrompt = resolveSkillPrompt(skillName);
    if (skillPrompt) {
      segments.push({
        id: 'skill',
        title: `活跃技能：${skillName}`,
        tokens: 0,
        content: `# Active Skill: ${skillName}\n\n${skillPrompt}`,
        defaultOpen: true,
      });
    }
  }
  return segments.map(s => ({ ...s, tokens: estimateTextTokens(s.content) }));
}

/** 使提示词缓存失效（测试/提示词文件被路由写回时调用） */
export function invalidateSystemPromptCache(): void {
  promptCache = null;
}
