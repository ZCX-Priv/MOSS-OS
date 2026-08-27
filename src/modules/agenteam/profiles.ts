// src/modules/agenteam/profiles.ts
// 团队模板（Profiles）：可复用的团队配置。
// 内置 1 个默认 profile「研发流水线」；用户可将当前团队保存为模板，
// 持久化于 ~/.moss/agent-team-profiles.json。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Logger } from '../../core/types';
import type { TeamProfileConfig } from './types';

/** 内置团队模板 */
export const BUILTIN_TEAM_PROFILES: readonly TeamProfileConfig[] = [
  {
    name: 'dev-pipeline',
    description: '研发流水线：探索 → 需求 → 实现 → 评审，含质量门禁循环',
    protocol:
      '成员按依赖顺序推进任务；实现完成后必须经 Reviewer 审查通过；审查未通过自动生成修复任务循环，直至通过或触顶升级。',
    builtIn: true,
    taskPlanning: 'seed',
    reviewPolicy: {
      requirementsMinRounds: 1,
      requirementsMaxRounds: 3,
      codeMaxRounds: 2,
      maxRepairAttempts: 2,
    },
    members: [
      { name: 'explorer', role: 'explorer', agentId: 'agent_explorer' },
      { name: 'planner', role: 'planner', agentId: 'agent_planner' },
      { name: 'coder', role: 'engineer', agentId: 'agent_coder' },
      { name: 'reviewer', role: 'reviewer', agentId: 'agent_reviewer' },
    ],
    tasks: [
      {
        seedId: 'explore',
        subject: '探索代码库结构与相关模块',
        kind: 'work',
        assignee: 'explorer',
      },
      {
        seedId: 'requirements',
        subject: '梳理需求与实现方案',
        kind: 'requirements',
        dependencies: ['explore'],
        assignee: 'planner',
      },
      {
        seedId: 'implement',
        subject: '按方案实现改动',
        kind: 'implementation',
        dependencies: ['requirements'],
        assignee: 'coder',
      },
      {
        seedId: 'review',
        subject: '对抗性审查实现',
        kind: 'review',
        dependencies: ['implement'],
        assignee: 'reviewer',
      },
    ],
  },
];

/** 团队模板存储 */
export class TeamProfileStore {
  private readonly storePath: string;
  private readonly logger: Logger;
  private profiles: Map<string, TeamProfileConfig>;

  constructor(dataDir: string, logger: Logger) {
    this.storePath = join(dataDir, 'agent-team-profiles.json');
    this.logger = logger;
    this.profiles = this.load();
  }

  private load(): Map<string, TeamProfileConfig> {
    const map = new Map<string, TeamProfileConfig>();
    // 内置模板先入（可被同名自定义覆盖加载顺序：先内置后用户）
    for (const p of BUILTIN_TEAM_PROFILES) map.set(p.name, p);
    try {
      if (!existsSync(this.storePath)) return map;
      const raw = JSON.parse(readFileSync(this.storePath, 'utf8')) as {
        profiles?: TeamProfileConfig[];
      };
      if (Array.isArray(raw.profiles)) {
        for (const p of raw.profiles) {
          if (p && typeof p.name === 'string' && Array.isArray(p.members) && Array.isArray(p.tasks)) {
            map.set(p.name, { ...p, builtIn: false });
          }
        }
      }
    } catch (err) {
      this.logger.warn('agent-teams: profiles load failed, using builtin only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return map;
  }

  private saveUserProfiles(): void {
    const userProfiles = [...this.profiles.values()].filter((p) => !p.builtIn);
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(
        this.storePath,
        JSON.stringify({ version: 1, profiles: userProfiles }, null, 2),
        'utf8',
      );
    } catch (err) {
      this.logger.error('agent-teams: profiles save failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  list(): TeamProfileConfig[] {
    return [...this.profiles.values()];
  }

  get(name: string): TeamProfileConfig | null {
    return this.profiles.get(name) ?? null;
  }

  /** 保存/覆盖用户模板（内置模板名不允许覆盖） */
  upsert(profile: TeamProfileConfig): boolean {
    const existing = this.profiles.get(profile.name);
    if (existing?.builtIn) return false;
    this.profiles.set(profile.name, { ...profile, builtIn: false });
    this.saveUserProfiles();
    return true;
  }

  remove(name: string): boolean {
    const existing = this.profiles.get(name);
    if (!existing || existing.builtIn) return false;
    this.profiles.delete(name);
    this.saveUserProfiles();
    return true;
  }
}
