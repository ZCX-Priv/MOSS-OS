// src/modules/agenteam/store.ts
// 团队持久化存储：~/.moss/agent-teams/<teamId>/team.json + messages.jsonl
// 写入原子化（临时文件 + rename），消息流追加写。

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../../core/types';
import type { TeamMessage, TeamState, TeamSummary } from './types';

/** 单条依赖输出截断上限（字符） */
const DEPENDENCY_OUTPUT_MAX_CHARS = 4000;
/** 依赖输出总量截断上限（字符） */
const DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS = 12000;

/** 团队目录 id 清洗（防路径穿越） */
export function safeTeamId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

export class TeamStore {
  private readonly rootDir: string;
  private readonly logger: Logger;

  constructor(dataDir: string, logger: Logger) {
    this.rootDir = join(dataDir, 'agent-teams');
    this.logger = logger;
    try {
      mkdirSync(this.rootDir, { recursive: true });
    } catch (err) {
      this.logger.error('agent-teams: store dir create failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private teamDir(teamId: string): string {
    return join(this.rootDir, safeTeamId(teamId));
  }

  private teamFile(teamId: string): string {
    return join(this.teamDir(teamId), 'team.json');
  }

  private messagesFile(teamId: string): string {
    return join(this.teamDir(teamId), 'messages.jsonl');
  }

  list(): TeamState[] {
    const teams: TeamState[] = [];
    try {
      if (!existsSync(this.rootDir)) return teams;
      for (const entry of readdirSync(this.rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const team = this.get(entry.name);
        if (team) teams.push(team);
      }
    } catch (err) {
      this.logger.warn('agent-teams: list failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return teams.sort((a, b) => b.createdAt - a.createdAt);
  }

  summaries(): TeamSummary[] {
    return this.list().map((team) => {
      const total = team.tasks.length;
      const completed = team.tasks.filter((t) => t.status === 'completed').length;
      const updatedAt = team.tasks.reduce(
        (max, t) => Math.max(max, t.updatedAt),
        team.createdAt,
      );
      return {
        id: team.id,
        name: team.name,
        description: team.description,
        phase: team.phase,
        planReviewState: team.planReviewState,
        memberCount: team.members.filter((m) => m.status !== 'removed').length,
        taskTotal: total,
        taskCompleted: completed,
        createdAt: team.createdAt,
        updatedAt,
      };
    });
  }

  get(teamId: string): TeamState | null {
    try {
      const file = this.teamFile(teamId);
      if (!existsSync(file)) return null;
      const raw = JSON.parse(readFileSync(file, 'utf8')) as TeamState;
      if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.members) || !Array.isArray(raw.tasks)) {
        return null;
      }
      return raw;
    } catch {
      return null;
    }
  }

  save(team: TeamState): void {
    try {
      const dir = this.teamDir(team.id);
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `team.json.tmp`);
      writeFileSync(tmp, JSON.stringify(team, null, 2), 'utf8');
      renameSync(tmp, this.teamFile(team.id));
    } catch (err) {
      this.logger.error('agent-teams: save failed', {
        teamId: team.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  delete(teamId: string): boolean {
    try {
      const dir = this.teamDir(teamId);
      if (!existsSync(dir)) return false;
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (err) {
      this.logger.error('agent-teams: delete failed', {
        teamId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  appendMessage(teamId: string, message: TeamMessage): void {
    try {
      const dir = this.teamDir(teamId);
      mkdirSync(dir, { recursive: true });
      const file = this.messagesFile(teamId);
      writeFileSync(file, JSON.stringify(message) + '\n', { encoding: 'utf8', flag: 'a' });
    } catch (err) {
      this.logger.warn('agent-teams: appendMessage failed', {
        teamId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  listMessages(teamId: string, since?: number): TeamMessage[] {
    try {
      const file = this.messagesFile(teamId);
      if (!existsSync(file)) return [];
      const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
      const messages: TeamMessage[] = [];
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as TeamMessage;
          if (since === undefined || msg.ts > since) messages.push(msg);
        } catch {
          // 单行损坏跳过
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  /** 生成下一个团队 id（team_<时间戳>_<随机>) */
  nextTeamId(): string {
    return `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export {
  DEPENDENCY_OUTPUT_MAX_CHARS,
  DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS,
};
