// src/modules/file-history/ledger.ts
// Read Ledger：会话级追踪已 read 的文件 + 内容 sha。
// read-before-overwrite 强制约束的数据基础。
// 持久化：~/.moss/file-history/ledger/<sessionId>.json（防抖落盘 + 懒加载），重启后 read 记录仍有效
// （修复旧版仅内存、重启即失效，与 transcript 持久化能力不对称的割裂）。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../../core/types';
import { safeSessionId, writeJsonStore } from '../filesys/store-io';

/** 单会话的 read 记录：absPath → sha256 */
type SessionReadMap = Map<string, string>;

/** 落盘防抖间隔：read 频繁时合并写（降低 IO），上限 5 秒内必落 */
const FLUSH_DEBOUNCE_MS = 5000;

export class ReadLedger {
  /** sessionId → (absPath → sha) */
  private readonly sessions = new Map<string, SessionReadMap>();
  /** 已从磁盘加载过的 session（避免重复 IO） */
  private readonly loaded = new Set<string>();
  /** 脏标记：sessionId → 定时器 */
  private readonly dirtyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ledgerDir: string | null;
  private readonly logger?: Logger;

  constructor(ledgerDir?: string, logger?: Logger) {
    this.ledgerDir = ledgerDir ?? null;
    this.logger = logger;
  }

  private ledgerPath(sessionId: string): string | null {
    if (!this.ledgerDir) return null;
    const safe = safeSessionId(sessionId);
    if (!safe) return null;
    return join(this.ledgerDir, `${safe}.json`);
  }

  /** 懒加载：首次访问该 session 时从磁盘恢复 */
  private ensureLoaded(sessionId: string): void {
    if (this.loaded.has(sessionId)) return;
    this.loaded.add(sessionId);
    if (!this.sessions.has(sessionId)) {
      const path = this.ledgerPath(sessionId);
      if (path && existsSync(path)) {
        try {
          const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
          const m: SessionReadMap = new Map();
          for (const [k, v] of Object.entries(raw)) {
            if (typeof k === 'string' && typeof v === 'string') m.set(k, v);
          }
          this.sessions.set(sessionId, m);
        } catch (err) {
          this.logger?.warn('file-history: ledger load failed, starting fresh', {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  /**
   * 标记文件已被 read。
   * @param sessionId 会话 ID
   * @param absPath 文件绝对路径
   * @param sha 文件内容 sha256
   */
  markRead(sessionId: string, absPath: string, sha: string): void {
    this.ensureLoaded(sessionId);
    let m = this.sessions.get(sessionId);
    if (!m) {
      m = new Map();
      this.sessions.set(sessionId, m);
    }
    m.set(absPath, sha);
    this.scheduleFlush(sessionId);
  }

  /**
   * 校验本会话是否 read 过该文件。
   * @returns true 表示已 read
   */
  isRead(sessionId: string, absPath: string): boolean {
    this.ensureLoaded(sessionId);
    return this.sessions.get(sessionId)?.has(absPath) ?? false;
  }

  /** 获取某会话某文件的 sha（用于变更检测） */
  getSha(sessionId: string, absPath: string): string | undefined {
    this.ensureLoaded(sessionId);
    return this.sessions.get(sessionId)?.get(absPath);
  }

  /** 防抖落盘（同 session 的连续 read 合并为一次写） */
  private scheduleFlush(sessionId: string): void {
    const path = this.ledgerPath(sessionId);
    if (!path) return;
    const existing = this.dirtyTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.dirtyTimers.delete(sessionId);
      this.flushSync(sessionId);
    }, FLUSH_DEBOUNCE_MS);
    // 不阻止进程退出
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as { unref(): void }).unref();
    }
    this.dirtyTimers.set(sessionId, timer);
  }

  /** 立即落盘单个 session（进程退出前/测试用） */
  private flushSync(sessionId: string): void {
    const path = this.ledgerPath(sessionId);
    if (!path) return;
    const m = this.sessions.get(sessionId);
    if (!m) return;
    try {
      writeJsonStore(path, Object.fromEntries(m));
    } catch (err) {
      this.logger?.warn('file-history: ledger flush failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 清理会话的所有 read 记录（会话结束时调用：内存 + 磁盘 ledger 文件一并清除） */
  clearSession(sessionId: string): void {
    const timer = this.dirtyTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.dirtyTimers.delete(sessionId);
    }
    this.sessions.delete(sessionId);
    this.loaded.add(sessionId); // 已清理，不再懒加载旧文件
    const path = this.ledgerPath(sessionId);
    if (path && existsSync(path)) {
      try {
        const { unlinkSync } = require('node:fs') as typeof import('node:fs');
        unlinkSync(path);
      } catch {
        /* 删除失败不阻断 */
      }
    }
  }
}
