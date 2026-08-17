// src/modules/safety/patterns.ts
// 危险命令智能拦截（Windows 务实沙箱）+ 保护路径检测。
// 借鉴 Claude Code dangerousPatterns + pathValidation，覆盖 Windows/POSIX 双平台。
// 匹配策略：命令小写化 → 复合拆段（&& ; | 换行）→ 逐段正则匹配；误报从严（fail-closed）。

import { isPathInside } from '../../utils/fs';
import { splitCommandSegments, extractTargetPaths } from './rules';

/** 危险级别 */
export type DangerLevel = 'block' | 'caution';

export interface DangerousPattern {
  /** 级别：block=直接拒绝；caution=弹确认（策略可配） */
  level: DangerLevel;
  /** 人类可读的模式描述（i18n 占位，展示用） */
  label: string;
  /** 匹配正则（针对单段命令，小写输入） */
  re: RegExp;
}

/**
 * BLOCK 级：磁盘/注册表/引导/提权/管道执行 —— 无条件不可恢复的破坏。
 */
const BLOCK_PATTERNS: DangerousPattern[] = [
  { level: 'block', label: 'format (磁盘格式化)', re: /(^|\s)format(\s|$)/ },
  { level: 'block', label: 'diskpart (磁盘分区)', re: /(^|\s)diskpart(\s|$)/ },
  { level: 'block', label: 'mkfs (文件系统创建)', re: /(^|\s)mkfs(\.|\s|$)/ },
  { level: 'block', label: 'bcdedit (引导配置)', re: /(^|\s)bcdedit(\s|$)/ },
  { level: 'block', label: 'bootrec (引导修复)', re: /(^|\s)bootrec(\s|$)/ },
  { level: 'block', label: 'fdisk (分区表操作)', re: /(^|\s)fdisk(\s|$)/ },
  { level: 'block', label: 'reg delete/add (注册表)', re: /(^|\s)reg(\s+(delete|add|import|restore)\b)/ },
  { level: 'block', label: 'rm -rf 根/家目录 (危险移除)', re: /(^|\s)rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|~|\*|"\/)/ },
  { level: 'block', label: 'del /f /s /q (Windows 强删)', re: /(^|\s)(del|erase)\s+("[^"]*"|\S+)\s*\/[a-z]*f/ },
  { level: 'block', label: 'rd /s / q (Windows 递归删目录)', re: /(^|\s)(rd|rmdir)\s+("[^"]*"|\S+)\s*\/[a-z]*s/ },
  { level: 'block', label: 'Remove-Item -Recurse -Force', re: /remove-item\s+[^|;]*(-recurse[^|;]*-force|-force[^|;]*-recurse)/ },
  { level: 'block', label: 'runas (提权执行)', re: /(^|\s)runas(\s|$)/ },
  { level: 'block', label: 'Start-Process -Verb RunAs (提权)', re: /start-process\s+[^|;]*-verb\s+runas/ },
  {
    level: 'block',
    label: '下载管道执行 (curl/wget | shell)',
    re: /(curl|wget)[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|powershell|pwsh|cmd)(\s|$)/,
  },
  { level: 'block', label: 'iex / Invoke-Expression (动态执行)', re: /(^|[(\s])(iex|invoke-expression)\s*[((]/ },
  { level: 'block', label: 'powershell EncodedCommand (混淆执行)', re: /powershell[^|;&]*-enc(odedcommand)?\s+/ },
];

/**
 * CAUTION 级：不可逆 VCS/发布操作 —— 弹确认（cautionPolicy 可配为 deny）。
 */
const CAUTION_PATTERNS: DangerousPattern[] = [
  { level: 'caution', label: 'git push --force (强制推送)', re: /git\s+push[^|;&]*\s(--force|-f)(\s|$)/ },
  { level: 'caution', label: 'git reset --hard (硬重置)', re: /git\s+reset\s+--hard(\s|$)/ },
  { level: 'caution', label: 'git clean -fd (清理未跟踪)', re: /git\s+clean[^|;&]*\s-[a-z]*f[a-z]*d|git\s+clean[^|;&]*\s-[a-z]*d[a-z]*f/ },
  { level: 'caution', label: 'npm publish (发布包)', re: /(^|\s)npm\s+publish(\s|$)/ },
  { level: 'caution', label: 'chmod -R 777 (开放全部权限)', re: /chmod\s+(-r\s+)?777(\s|$)/ },
];

/**
 * 检测 shell 命令是否命中危险模式。
 * @returns 命中的模式（block 优先于 caution）；null=安全
 */
export function matchDangerousCommand(command: string): DangerousPattern | null {
  const segments = splitCommandSegments(command.toLowerCase());
  // BLOCK 优先：任一段命中 block 即整体拒绝
  for (const seg of segments) {
    for (const p of BLOCK_PATTERNS) {
      if (p.re.test(seg)) return p;
    }
  }
  for (const seg of segments) {
    for (const p of CAUTION_PATTERNS) {
      if (p.re.test(seg)) return p;
    }
  }
  return null;
}

/** 展开路径中的 ~ 前缀（用户目录）与常见环境变量形态 */
function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return `${home}/${p.slice(2)}`;
  }
  return p;
}

/** 归一化分隔符（统一为 /，大小写不敏感比较由调用方处理） */
function normalizeSep(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * 保护路径检测（写类工具目标路径）。
 * @param params 工具参数（提取 path/dest/to/target）
 * @param protectedPaths 用户可配置保护路径（~ 前缀支持）
 * @param home 用户目录（~ 展开）
 * @returns 命中的保护路径原文；null=不在保护范围
 */
export function matchProtectedPath(
  params: unknown,
  protectedPaths: string[],
  home: string,
): string | null {
  const targets = extractTargetPaths(params);
  if (targets.length === 0) return null;
  const expanded = protectedPaths.map((p) => normalizeSep(expandHome(p.trim(), home)));
  for (const target of targets) {
    const t = normalizeSep(expandHome(target.trim(), home));
    for (const pp of expanded) {
      // 双向包含：目标在保护路径下，或目标覆盖保护路径（如删除整个父目录）
      if (isPathInside(t, pp) || isPathInside(pp, t)) return pp;
    }
  }
  return null;
}

/** 硬保护路径（代码内置，防 AI 自我提权；skip 模式下不生效——用户明确授权） */
export function isHardProtectedPath(
  params: unknown,
  home: string,
  configDir: string,
): boolean {
  const targets = extractTargetPaths(params);
  const cfg = normalizeSep(configDir);
  for (const target of targets) {
    const t = normalizeSep(expandHome(target.trim(), home));
    if (t === cfg || isPathInside(cfg, t) || isPathInside(t, cfg)) return true;
  }
  return false;
}
