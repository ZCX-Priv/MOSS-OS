// src/modules/context/file-index/project-context.ts
// 项目概要锚定消息（大局观注入）：
//   - 会话首条（env-context 之后）追加 [项目概要] 消息：结构统计 + 核心模块 + 核心概念
//   - append-only 纪律：一旦写入永不修改（保前缀缓存稳定；仅新会话获得最新概要）
//   - 索引构建中 → 占位文本（下轮不回改，新会话自然获得完整版）

import type { ContextMessage, ContextSessionLike } from '../types';
import { ENV_CONTEXT_MSG_NAME } from '../compiler/env-context';

export const PROJECT_CONTEXT_MSG_NAME = 'project-context';

/**
 * 保障会话拥有项目概要锚定消息（幂等；graph/sag 任一开启时由 governor 调用）。
 * @param getOverview 概要文本生成（索引未就绪时返回占位；模块关闭返回 null 不注入）
 * @returns true 表示消息流变化（需持久化）
 */
export async function ensureProjectContext(
  session: ContextSessionLike,
  getOverview: () => Promise<string | null>,
): Promise<boolean> {
  const has = session.messages.some(m => m.name === PROJECT_CONTEXT_MSG_NAME);
  if (has) return false;

  const overview = await getOverview();
  if (overview === null) return false; // 模块关闭：不注入（后续开启后新 run 会补建）

  const msg: ContextMessage = {
    role: 'user',
    name: PROJECT_CONTEXT_MSG_NAME,
    content: overview,
    timestamp: new Date().toISOString(),
  };

  // 插入位置：env-context 锚定消息之后；无 env-context 则消息流最前
  const envIdx = session.messages.findIndex(m => m.name === ENV_CONTEXT_MSG_NAME);
  if (envIdx >= 0) {
    session.messages.splice(envIdx + 1, 0, msg);
  } else {
    session.messages.unshift(msg);
  }
  return true;
}
