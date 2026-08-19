// src/modules/context/compiler/env-context.ts
// 环境上下文消息：时间/平台/git 状态等动态信息以会话首条消息锚定（append-only），
// system prompt 保持纯静态 → 前缀字节级稳定（缓存命中黄金法则：静态在前、动态在后）。
// - 会话创建时生成一次，之后永不修改（修改旧消息 = 破坏前缀）
// - 跨天继续会话：在消息流末尾「追加」日期提示消息（不改动历史）
// - 旧会话（无 env-context）：首次 run 补建并插到消息流最前（一次性进入新缓存周期）

import { execSync } from 'node:child_process';
import type { Environment } from '../../../core/types';
import type { ContextMessage, ContextSessionLike } from '../types';

/** 消息 name 标识 */
export const ENV_CONTEXT_MSG_NAME = 'env-context';
export const DAY_ROLLOVER_MSG_NAME = 'day-rollover';

/** git status 快照截断上限（借鉴 claude-code MAX_STATUS_CHARS） */
const MAX_GIT_STATUS_CHARS = 2000;

/** git 命令超时（ms）：非 git 目录/慢仓库不拖慢会话启动 */
const GIT_TIMEOUT_MS = 3000;

/** 今日日期 YYYY-MM-DD */
export function todayDate(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 当前时间字符串（env-context 快照用） */
function nowTimeString(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${todayDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** 安全执行 git 命令（失败/超时返回 null） */
function git(args: string, cwd: string): string | null {
  try {
    const out = execSync(`git ${args}`, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return out.trim();
  } catch {
    return null;
  }
}

/** 生成 git 状态快照段（非 git 目录返回 null） */
function buildGitSnapshot(cwd: string): string | null {
  const branch = git('rev-parse --abbrev-ref HEAD', cwd);
  if (branch === null) return null;
  const status = git('--no-optional-locks status --short', cwd) ?? '';
  const log = git('--no-optional-locks log --oneline -n 5', cwd) ?? '';

  const truncatedStatus =
    status.length > MAX_GIT_STATUS_CHARS
      ? `${status.slice(0, MAX_GIT_STATUS_CHARS)}\n...（状态过长已截断，需要完整信息请运行 git status）`
      : status;

  return [
    '[Git 状态快照]（会话开始时拍摄，期间不会自动更新）',
    `当前分支: ${branch}`,
    `状态:\n${truncatedStatus || '（工作区干净）'}`,
    `最近提交:\n${log || '（无提交记录）'}`,
  ].join('\n');
}

/**
 * 构建环境上下文消息（会话首条锚定消息）。
 * content 含生成时刻的时间快照——此后永不修改（append-only 纪律）。
 */
export function buildEnvContextMessage(env: Environment, cwd: string): ContextMessage {
  const parts: string[] = [
    '[环境上下文]',
    `当前时间: ${nowTimeString()}（${Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'}）`,
    `平台: ${prettyPlatform(env.platform)}（${env.platform}, ${env.arch}）`,
  ];
  const gitSnapshot = buildGitSnapshot(cwd);
  if (gitSnapshot) parts.push(gitSnapshot);
  return {
    role: 'user',
    name: ENV_CONTEXT_MSG_NAME,
    content: parts.join('\n\n'),
    timestamp: new Date().toISOString(),
  };
}

function prettyPlatform(p: string): string {
  switch (p) {
    case 'win32': return 'Windows';
    case 'darwin': return 'macOS';
    case 'linux': return 'Linux';
    default: return 'Other';
  }
}

/**
 * 会话环境上下文保障（每次 run 开始时调用）：
 * 1. 无 env-context 消息（旧会话/新会话）→ 补建并插到消息流最前 + 写 envContext 锚定信息
 * 2. 跨天（envContext.date ≠ 今天）→ 末尾追加日期提示消息（append-only，不破坏前缀）
 * @returns true 表示消息流发生了变化（需要持久化）
 */
export function ensureEnvContext(session: ContextSessionLike, env: Environment, cwd: string): boolean {
  let changed = false;
  const today = todayDate();

  const hasEnvMsg = session.messages.some(m => m.name === ENV_CONTEXT_MSG_NAME);
  if (!hasEnvMsg) {
    session.messages.unshift(buildEnvContextMessage(env, cwd));
    session.envContext = { createdAt: new Date().toISOString(), date: today };
    changed = true;
  }

  // 跨天检测：锚定日期 ≠ 今天 → 追加日期消息（今天内多次 run 只追加一次）
  if (session.envContext && session.envContext.date !== today) {
    session.messages.push({
      role: 'user',
      name: DAY_ROLLOVER_MSG_NAME,
      content: `[时间提示] 当前日期已更新为 ${today}（跨天继续会话，此前的环境上下文快照中的时间已过期）。`,
      timestamp: new Date().toISOString(),
    });
    session.envContext = { ...session.envContext, date: today };
    changed = true;
  }

  return changed;
}
