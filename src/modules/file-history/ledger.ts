// src/modules/file-history/ledger.ts
// Read Ledger：会话级内存追踪已 read 的文件 + 内容 sha。
// read-before-overwrite 强制约束的数据基础。
// 仅内存（不持久化），会话结束清空。

/** 单会话的 read 记录：absPath → sha256 */
type SessionReadMap = Map<string, string>;

export class ReadLedger {
  /** sessionId → (absPath → sha) */
  private readonly sessions = new Map<string, SessionReadMap>();

  /**
   * 标记文件已被 read。
   * @param sessionId 会话 ID
   * @param absPath 文件绝对路径
   * @param sha 文件内容 sha256
   */
  markRead(sessionId: string, absPath: string, sha: string): void {
    let m = this.sessions.get(sessionId);
    if (!m) {
      m = new Map();
      this.sessions.set(sessionId, m);
    }
    m.set(absPath, sha);
  }

  /**
   * 校验本会话是否 read 过该文件。
   * @returns true 表示已 read
   */
  isRead(sessionId: string, absPath: string): boolean {
    return this.sessions.get(sessionId)?.has(absPath) ?? false;
  }

  /** 获取某会话某文件的 sha（用于变更检测） */
  getSha(sessionId: string, absPath: string): string | undefined {
    return this.sessions.get(sessionId)?.get(absPath);
  }

  /** 清理会会话的所有 read 记录（会话结束时调用） */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
