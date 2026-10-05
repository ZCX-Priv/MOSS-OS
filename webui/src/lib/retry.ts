// webui/src/lib/retry.ts
// 瞬时失败退避重试：仅对「网络层失败」与「503 服务暂不可用」重试，其它错误立即抛出。
// 使用场景：后端内核启动窗口内 agent 引擎未就绪（路由返回 503）、或后端重启/冷启动期间的
// 首批列表与历史拉取——重试后无需用户手动刷新即可自愈。

import { isTransientFailure } from '../api/http';

export interface RetryOptions {
  /** 最大尝试次数（含首次），默认 4 */
  attempts?: number;
  /** 首次退避基数（ms），按 2 的幂递增，默认 300 */
  baseDelayMs?: number;
}

/** 退避重试包装：非瞬时错误立即抛出，瞬时错误按指数退避重试至上限后抛出最后一次错误 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const baseDelayMs = opts.baseDelayMs ?? 300;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransientFailure(err)) throw err;
      await delay(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}