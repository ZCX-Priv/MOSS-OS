// src/modules/agents/index.ts
// Agents 模组入口：实现 AgentRegistry，注册 agents.registry 服务。
// 持久化到 ~/.moss/agents.json，预置 1 个内置 Agent（name:"Agent", builtIn:true, default:true）。

import { t } from '../../core/i18n';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Module, ModuleContext, ModuleManifest, Environment, Logger } from '../../core/types';
import { ServiceNames } from '../../core/types';

// ============================================================================
// 类型定义（与前端 webui/src/types/api.ts 对齐）
// ============================================================================

export interface AgentItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  builtIn: boolean;
  default?: boolean;
}

export interface AgentDetail extends AgentItem {
  systemPrompt?: string;
  model?: string;
  tools?: string[];
  maxTurns?: number;
  maxTokens?: number;
}

interface AgentsStoreData {
  version: number;
  defaultAgentId: string;
  agents: AgentDetail[];
}

// ============================================================================
// AgentRegistry 实现
// ============================================================================

export interface AgentRegistry {
  list(): AgentItem[];
  get(id: string): AgentDetail | null;
  create(data: {
    name: string;
    description?: string;
    systemPrompt?: string;
    model?: string;
    tools?: string[];
    icon?: string;
    maxTurns?: number;
    maxTokens?: number;
  }): AgentItem;
  update(id: string, patch: Partial<AgentDetail>): AgentDetail | null;
  remove(id: string): boolean;
  getDefault(): AgentDetail;
  setDefault(id: string): boolean;
}

class AgentRegistryImpl implements AgentRegistry {
  private readonly storePath: string;
  private readonly logger: Logger;
  private data: AgentsStoreData;

  constructor(env: Environment, logger: Logger) {
    this.storePath = join(env.dataDir, 'agents.json');
    this.logger = logger;
    this.data = this.load();
  }

  private load(): AgentsStoreData {
    const defaultData: AgentsStoreData = {
      version: 1,
      defaultAgentId: 'agent',
      agents: [
        {
          id: 'agent',
          name: 'Agent',
          description: 'Default MOSS agent',
          icon: 'Bot',
          builtIn: true,
          default: true,
        },
      ],
    };

    try {
      const raw = readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as AgentsStoreData;
      if (!parsed.agents || !Array.isArray(parsed.agents)) return defaultData;
      // 确保内置 Agent 存在
      if (!parsed.agents.find(a => a.id === 'agent')) {
        parsed.agents.unshift(defaultData.agents[0]);
      }
      if (!parsed.defaultAgentId) parsed.defaultAgentId = 'agent';
      // 标记 default
      for (const a of parsed.agents) {
        a.default = a.id === parsed.defaultAgentId;
      }
      return parsed;
    } catch {
      return defaultData;
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error(t('agents.saveFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  list(): AgentItem[] {
    return this.data.agents.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      builtIn: a.builtIn,
      default: a.id === this.data.defaultAgentId,
    }));
  }

  get(id: string): AgentDetail | null {
    const a = this.data.agents.find(x => x.id === id);
    return a ? { ...a, default: a.id === this.data.defaultAgentId } : null;
  }

  create(data: {
    name: string;
    description?: string;
    systemPrompt?: string;
    model?: string;
    tools?: string[];
    icon?: string;
    maxTurns?: number;
    maxTokens?: number;
  }): AgentItem {
    const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const agent: AgentDetail = {
      id,
      name: data.name,
      description: data.description,
      icon: data.icon ?? 'Bot',
      builtIn: false,
      default: false,
      systemPrompt: data.systemPrompt,
      model: data.model,
      tools: data.tools,
      maxTurns: data.maxTurns,
      maxTokens: data.maxTokens,
    };
    this.data.agents.push(agent);
    this.save();
    this.logger.info(t('agents.agentCreated', { id, name: data.name }));
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      icon: agent.icon,
      builtIn: agent.builtIn,
      default: false,
    };
  }

  update(id: string, patch: Partial<AgentDetail>): AgentDetail | null {
    const idx = this.data.agents.findIndex(a => a.id === id);
    if (idx < 0) return null;
    const existing = this.data.agents[idx];
    if (existing.builtIn && patch.builtIn === false) {
      // 内置 Agent 不允许改为非内置
      return null;
    }
    // 不允许通过 patch 修改 id / builtIn / default
    const { id: _omitId, builtIn: _omitBuiltIn, default: _omitDefault, ...allowedPatch } = patch;
    this.data.agents[idx] = { ...existing, ...allowedPatch };
    this.save();
    return { ...this.data.agents[idx], default: this.data.agents[idx].id === this.data.defaultAgentId };
  }

  remove(id: string): boolean {
    const idx = this.data.agents.findIndex(a => a.id === id);
    if (idx < 0) return false;
    if (this.data.agents[idx].builtIn) return false;
    if (this.data.defaultAgentId === id) return false; // 默认 Agent 不允许删除
    this.data.agents.splice(idx, 1);
    this.save();
    this.logger.info(t('agents.agentRemoved', { id }));
    return true;
  }

  getDefault(): AgentDetail {
    const a = this.data.agents.find(x => x.id === this.data.defaultAgentId);
    if (a) return { ...a, default: true };
    // 兜底：返回第一个
    const first = this.data.agents[0];
    this.data.defaultAgentId = first.id;
    this.save();
    return { ...first, default: true };
  }

  setDefault(id: string): boolean {
    const exists = this.data.agents.some(a => a.id === id);
    if (!exists) return false;
    this.data.defaultAgentId = id;
    this.save();
    this.logger.info(t('agents.defaultSet', { id }));
    return true;
  }
}

// ============================================================================
// Module 入口
// ============================================================================

class AgentsModule implements Module {
  manifest!: ModuleManifest;

  async initialize(ctx: ModuleContext): Promise<void> {
    const registry = new AgentRegistryImpl(ctx.env, ctx.logger);
    ctx.services.register(ServiceNames.AGENTS_REGISTRY, registry, {
      scope: 'agents',
      registrantType: 'module',
    });
    ctx.logger.info(t('agents.moduleInitialized'), {
      agentCount: registry.list().length,
      defaultAgent: registry.getDefault().id,
    });
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new AgentsModule();
  m.manifest = manifest;
  return m;
};
