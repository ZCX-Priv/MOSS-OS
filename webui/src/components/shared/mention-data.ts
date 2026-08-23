// webui/src/components/shared/mention-data.ts
// 输入框 / @ # 触发菜单的类型、触发解析与过滤工具。
// 数据源由调用方动态注入（commands/skills/agents/文件搜索 API），本模块不含静态数据。

import type { LucideIcon } from 'lucide-react';

export type MentionKind = 'command' | 'agent' | 'file';

/**
 * / 菜单的命令项类型：command（~/.moss/commands/）或 skill（~/.moss/skills/）。
 * 两者都通过 / 菜单调起、一次性注入（渲染后作为单条用户消息发送）。
 */
export type MentionCommandSource = 'command' | 'skill';

/** 分组 key，对应 i18n taskInput.mentionGroups.<group> */
export type MentionGroup = 'recent' | 'commands' | 'skills' | 'agents' | 'files';

export interface MentionItem {
  id: string;
  kind: MentionKind;
  group: MentionGroup;
  name: string;
  desc: string;
  icon: LucideIcon;
  /** 图标着色类（各项独立色彩） */
  iconClass: string;
  /** command/skill 项的注入载荷（选中时快照；发送时渲染 $ARGUMENTS） */
  data?: MentionChipData;
}

export type MentionTrigger = '/' | '@' | '#';

export interface TriggerMatch {
  kind: MentionKind;
  trigger: MentionTrigger;
  /** 触发符后的过滤关键字 */
  query: string;
  /** 触发符在文本中的下标（含触发符，删除区间起点） */
  tokenStart: number;
}

/** command/skill chip 载荷：选中时刻的注入快照 */
export interface MentionChipData {
  /** 来源体系：command（自定义命令）/ skill（技能） */
  source: MentionCommandSource;
  name: string;
  /** prompt 模板（可含 $ARGUMENTS 占位符） */
  prompt: string;
}

const TRIGGER_KIND: Record<MentionTrigger, MentionKind> = {
  '/': 'command',
  '@': 'agent',
  '#': 'file',
};

/**
 * 解析光标前最近一个 token：以 / @ # 开头（前面是行首或空白）则命中。
 * 返回 null 表示未命中（菜单应关闭）。
 */
export function detectTrigger(text: string, cursorPos: number): TriggerMatch | null {
  const before = text.slice(0, cursorPos);
  const m = /(^|\s)([/@#])([^\s/@#]*)$/.exec(before);
  if (!m) return null;
  const trigger = m[2] as MentionTrigger;
  const query = m[3];
  return {
    kind: TRIGGER_KIND[trigger],
    trigger,
    query,
    tokenStart: before.length - query.length - 1,
  };
}

/** 按关键字过滤（匹配名称或描述，大小写不敏感），保持传入分组顺序 */
export function filterMentionItems(items: MentionItem[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (it) => it.name.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q),
  );
}

/**
 * 一次性注入模板渲染（command 与 skill 统一）：
 * - 模板含 $ARGUMENTS → 替换为 args（args 为空则替换为空串）
 * - 模板不含占位符且 args 非空 → 模板 + 空行 + args
 */
export function renderPromptTemplate(prompt: string, args: string): string {
  if (prompt.includes('$ARGUMENTS')) {
    return prompt.replace(/\$ARGUMENTS/g, args);
  }
  const trimmedArgs = args.trim();
  return trimmedArgs ? `${prompt}\n\n${trimmedArgs}` : prompt;
}

// ============================================================================
// 最近使用命令（localStorage 持久化，最多 5 条去重；选中时移到最前）
// 存储结构：["cmd:<name>" | "skill:<name>"]；旧版纯 name 数据视为 skill:name 兼容。
// ============================================================================

const RECENT_COMMANDS_KEY = 'moss.recent-commands';
const RECENT_COMMANDS_MAX = 5;

/** 解析存储条目 → {source, name}；旧版纯 name 视为 skill */
function parseRecentEntry(entry: string): { source: MentionCommandSource; name: string } {
  if (entry.startsWith('cmd:')) return { source: 'command', name: entry.slice(4) };
  if (entry.startsWith('skill:')) return { source: 'skill', name: entry.slice(6) };
  return { source: 'skill', name: entry };
}

export function readRecentCommands(): Array<{ source: MentionCommandSource; name: string }> {
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .map(parseRecentEntry);
  } catch {
    return [];
  }
}

/** 记录一次命令使用：置顶去重，超出上限截断 */
export function touchRecentCommand(source: MentionCommandSource, name: string): void {
  const key = source === 'command' ? `cmd:${name}` : `skill:${name}`;
  try {
    const prev = readRecentCommands().map(
      (e) => (e.source === 'command' ? `cmd:${e.name}` : `skill:${e.name}`),
    );
    const next = [key, ...prev.filter((k) => k !== key)].slice(0, RECENT_COMMANDS_MAX);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式等）：静默放弃持久化
  }
}
