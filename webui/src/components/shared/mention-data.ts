// webui/src/components/shared/mention-data.ts
// 输入框 / @ # 触发菜单的类型、触发解析与 mock 数据（本轮纯样式占位，不接接口）。

import type { LucideIcon } from 'lucide-react';
import {
  ListTree,
  Target,
  Globe,
  Video,
  Image,
  Bot,
  Code2,
  LineChart,
  FileCode,
  FileJson,
  FileText,
  BookOpen,
} from 'lucide-react';

export type MentionKind = 'command' | 'agent' | 'file';

/** 分组 key，对应 i18n taskInput.mentionGroups.<group> */
export type MentionGroup = 'recent' | 'commands' | 'plugins' | 'agents' | 'files';

export interface MentionItem {
  id: string;
  kind: MentionKind;
  group: MentionGroup;
  name: string;
  desc: string;
  icon: LucideIcon;
  /** 图标着色类（各项独立色彩，复刻参考图） */
  iconClass: string;
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

// ============================================================================
// Mock 数据（展示用，名称/描述为数据本身，不做 i18n）
// ============================================================================

export const COMMAND_ITEMS: MentionItem[] = [
  {
    id: 'cmd-plan-recent',
    kind: 'command',
    group: 'recent',
    name: 'Plan',
    desc: '优先规划任务的执行方向，用户确认后再执行',
    icon: ListTree,
    iconClass: 'text-violet-400',
  },
  {
    id: 'cmd-plan',
    kind: 'command',
    group: 'commands',
    name: 'Plan',
    desc: '优先规划任务的执行方向，用户确认后再执行',
    icon: ListTree,
    iconClass: 'text-violet-400',
  },
  {
    id: 'cmd-goal',
    kind: 'command',
    group: 'commands',
    name: 'Goal',
    desc: '启动一个以目标为导向的任务，并持续运行直到完成',
    icon: Target,
    iconClass: 'text-blue-400',
  },
  {
    id: 'cmd-browser',
    kind: 'command',
    group: 'commands',
    name: 'Browser',
    desc: '启用浏览器操作模式进行网页自动化',
    icon: Globe,
    iconClass: 'text-cyan-400',
  },
  {
    id: 'plugin-seedance',
    kind: 'command',
    group: 'plugins',
    name: 'Seedance（视频生成）',
    desc: '使用 Seedance 将你的创意变成精彩视频。描述想要的画面、风格和动态效果，即可更准确地生成理想视频',
    icon: Video,
    iconClass: 'text-violet-400',
  },
  {
    id: 'plugin-seedream',
    kind: 'command',
    group: 'plugins',
    name: 'Seedream（图片生成）',
    desc: '使用 Seedream 将你的创意变成精美图片。描述想要的画面、风格和细节，即可更准确地生成理想图片',
    icon: Image,
    iconClass: 'text-fuchsia-400',
  },
];

export const AGENT_ITEMS: MentionItem[] = [
  {
    id: 'agent-default',
    kind: 'agent',
    group: 'agents',
    name: 'MOSS',
    desc: '默认智能体，处理日常各类任务',
    icon: Bot,
    iconClass: 'text-emerald-400',
  },
  {
    id: 'agent-coder',
    kind: 'agent',
    group: 'agents',
    name: 'Coder',
    desc: '专注代码编写、重构与调试的工程智能体',
    icon: Code2,
    iconClass: 'text-blue-400',
  },
  {
    id: 'agent-analyst',
    kind: 'agent',
    group: 'agents',
    name: 'Analyst',
    desc: '擅长数据分析、表格处理与图表洞察',
    icon: LineChart,
    iconClass: 'text-amber-400',
  },
  {
    id: 'agent-writer',
    kind: 'agent',
    group: 'agents',
    name: 'Writer',
    desc: '专注文档撰写、润色与结构化表达',
    icon: BookOpen,
    iconClass: 'text-rose-400',
  },
];

export const FILE_ITEMS: MentionItem[] = [
  {
    id: 'file-taskpage',
    kind: 'file',
    group: 'files',
    name: 'TaskPage.tsx',
    desc: 'webui/src/components/pages/TaskPage.tsx',
    icon: FileCode,
    iconClass: 'text-sky-400',
  },
  {
    id: 'file-taskinput',
    kind: 'file',
    group: 'files',
    name: 'TaskInput.tsx',
    desc: 'webui/src/components/shared/TaskInput.tsx',
    icon: FileCode,
    iconClass: 'text-sky-400',
  },
  {
    id: 'file-package',
    kind: 'file',
    group: 'files',
    name: 'package.json',
    desc: 'webui/package.json',
    icon: FileJson,
    iconClass: 'text-amber-400',
  },
  {
    id: 'file-readme',
    kind: 'file',
    group: 'files',
    name: 'README.md',
    desc: 'README.md',
    icon: FileText,
    iconClass: 'text-slate-400',
  },
];

export const MENTION_ITEMS: Record<MentionKind, MentionItem[]> = {
  command: COMMAND_ITEMS,
  agent: AGENT_ITEMS,
  file: FILE_ITEMS,
};

/** 按关键字过滤（匹配名称或描述，大小写不敏感），保持原分组顺序 */
export function filterMentionItems(kind: MentionKind, query: string): MentionItem[] {
  const items = MENTION_ITEMS[kind];
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (it) => it.name.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q),
  );
}
