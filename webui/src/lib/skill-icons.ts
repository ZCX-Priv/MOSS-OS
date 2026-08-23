// webui/src/lib/skill-icons.ts
// Skill/命令图标映射：icon 字符串（lucide kebab-case，SKILL.md frontmatter icon 字段）
// → LucideIcon 组件。白名单即「仅限于图标库」的边界：白名单外的 icon 回退 Sparkles。

import {
  Sparkles, ListTree, Target, Globe, Video, Image, Bot, Code2,
  LineChart, BookOpen, FileCode, FileJson, FileText, Terminal,
  Wrench, Zap, Brain, Rocket, PenLine, Languages, Calculator,
  Database, GitBranch, TestTube2, ShieldCheck, Palette, Music,
  Lightbulb, ShieldAlert, FlaskConical,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** icon 字符串 → LucideIcon 白名单（lucide 图标库子集） */
export const SKILL_ICON_MAP: Record<string, LucideIcon> = {
  'sparkles': Sparkles,
  'list-tree': ListTree,
  'target': Target,
  'globe': Globe,
  'video': Video,
  'image': Image,
  'bot': Bot,
  'code-2': Code2,
  'line-chart': LineChart,
  'book-open': BookOpen,
  'file-code': FileCode,
  'file-json': FileJson,
  'file-text': FileText,
  'terminal': Terminal,
  'wrench': Wrench,
  'zap': Zap,
  'brain': Brain,
  'rocket': Rocket,
  'pen-line': PenLine,
  'languages': Languages,
  'calculator': Calculator,
  'database': Database,
  'git-branch': GitBranch,
  'test-tube-2': TestTube2,
  'shield-check': ShieldCheck,
  'shield-alert': ShieldAlert,
  'flask-conical': FlaskConical,
  'lightbulb': Lightbulb,
  'palette': Palette,
  'music': Music,
};

/** 图标选择器选项（设置页表单用）：保持与 MAP 同步 */
export const SKILL_ICON_CHOICES: string[] = Object.keys(SKILL_ICON_MAP);

/** SKILL.md icon 字段 → 图标组件，未知/缺失回退 Sparkles */
export function resolveSkillIcon(name?: string): LucideIcon {
  if (!name) return Sparkles;
  return SKILL_ICON_MAP[name] ?? Sparkles;
}
