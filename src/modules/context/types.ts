// src/modules/context/types.ts
// 上下文引擎类型契约：配置、会话快照、压缩记录、自愈结果、统计遥测。
// 本文件不 import agent/contracts（避免模块循环）：ContextSessionLike 为
// agent/session Session 的结构子集（鸭子类型注入）。

import type { UnifiedMessage } from '../llm/types';

// ============================================================================
// 配置（config.context，由 config-service Zod schema 校验，此处为运行时类型）
// ============================================================================

export interface CompactionConfig {
  /** 是否启用自动压缩 */
  enabled: boolean;
  /** 触发阈值：估算 token ≥ 窗口 × compactRatio 时压缩 */
  compactRatio: number;
  /** 尾部逐字保留比例（占窗口） */
  tailKeepRatio: number;
  /** 摘要输出上限 token */
  summaryMaxTokens: number;
  /** 可压缩区最小 token（低于此值不值得一次摘要调用） */
  minFoldTokens: number;
  /** 摘要模型：'inherit' = 主模型；否则为 apiConfig.models 中的模型 id */
  summaryModel: string;
}

export interface ToolPruningConfig {
  enabled: boolean;
  /** 工具结果超过此字符数触发中段修剪（仅发送视图，session 原文不动） */
  thresholdChars: number;
  keepHeadChars: number;
  keepTailChars: number;
}

export interface HealerConfig {
  enabled: boolean;
  /** 工具名模糊纠正（编辑距离） */
  toolNameFuzzy: boolean;
  /** 参数 schema 校验 + 自动类型修正 */
  schemaFix: boolean;
}

export interface ContextTelemetryConfig {
  enabled: boolean;
}

export interface ContextEngineConfig {
  compaction: CompactionConfig;
  toolPruning: ToolPruningConfig;
  healer: HealerConfig;
  telemetry: ContextTelemetryConfig;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  compactRatio: 0.80,
  tailKeepRatio: 0.16,
  summaryMaxTokens: 8192,
  minFoldTokens: 400,
  summaryModel: 'inherit',
};

export const DEFAULT_TOOL_PRUNING_CONFIG: ToolPruningConfig = {
  enabled: true,
  thresholdChars: 8192,
  keepHeadChars: 4096,
  keepTailChars: 1024,
};

export const DEFAULT_HEALER_CONFIG: HealerConfig = {
  enabled: true,
  toolNameFuzzy: true,
  schemaFix: true,
};

export const DEFAULT_CONTEXT_TELEMETRY_CONFIG: ContextTelemetryConfig = {
  enabled: true,
};

export const DEFAULT_CONTEXT_CONFIG: ContextEngineConfig = {
  compaction: { ...DEFAULT_COMPACTION_CONFIG },
  toolPruning: { ...DEFAULT_TOOL_PRUNING_CONFIG },
  healer: { ...DEFAULT_HEALER_CONFIG },
  telemetry: { ...DEFAULT_CONTEXT_TELEMETRY_CONFIG },
};

// ============================================================================
// 会话快照（结构兼容 agent/session 的 Session / AgentMessage）
// ============================================================================

/**
 * 引擎可见的消息结构（AgentMessage 的结构子集 + compacted 标记）。
 * agent 模块的 AgentMessage 含 todoSnapshot 等额外字段，结构兼容可直接传入。
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    /** JSON 字符串 */
    arguments: string;
  }>;
  toolCallId?: string;
  thinking?: string;
  name?: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  /** 软删除标记（消息撤回）：发送视图过滤 */
  deletedAt?: string;
  /** 压缩标记：已被压缩摘要替代。发送视图排除（原文保留供前端历史展示） */
  compacted?: boolean;
}

/** 环境上下文锚定信息（会话创建时生成，append-only 保证前缀稳定） */
export interface EnvContextInfo {
  /** 生成时间 ISO 8601 */
  createdAt: string;
  /** 快照日期 YYYY-MM-DD（跨天检测依据） */
  date: string;
}

/** 压缩历史记录（持久化于 session.compactions） */
export interface CompactionRecord {
  id: string;
  at: string;
  trigger: 'auto' | 'manual';
  /** 压缩前估算 token */
  beforeTokens: number;
  /** 压缩后估算 token（含摘要消息） */
  afterTokens: number;
  /** 被压缩的消息条数 */
  compactedCount: number;
  /** 摘要全文（不含 <compaction-summary> 标签） */
  summary: string;
  /** 被压缩区间末条消息 timestamp（前端卡片定位） */
  boundaryTimestamp?: string;
  /** 摘要使用的模型（id 或 model 名） */
  summaryModel: string;
  /** 摘要生成耗时 ms */
  durationMs: number;
}

/** 引擎可见的会话结构（agent Session 的结构子集；鸭子类型注入避免循环依赖） */
export interface ContextSessionLike {
  id: string;
  messages: ContextMessage[];
  envContext?: EnvContextInfo;
  compactions?: CompactionRecord[];
  /** 会话级活跃 skill（system 模式拼系统提示后；message 模式替换 skill-inject 占位） */
  activeSkill?: { name: string; mode: 'system' | 'message' };
  updatedAt: string;
}

/** agent 模块注入的会话存取回调（bind 注入，保持依赖方向 agent → context） */
export interface SessionStoreBridge {
  get(sessionId: string): ContextSessionLike | null;
  persist(session: ContextSessionLike): void;
}

// ============================================================================
// 请求准备（governor 流水线输出）
// ============================================================================

/** token 构成分解 */
export interface ContextBreakdown {
  /** 系统提示词（含 skill system 模式注入） */
  system: number;
  /** 环境上下文消息 */
  env: number;
  /** 活跃压缩摘要 */
  summary: number;
  /** 历史消息（未压缩 + 工具结果修剪后） */
  history: number;
  total: number;
}

export interface PreparedRequest {
  /** 最终发送给 LLM 的消息（含 system 首条） */
  messages: UnifiedMessage[];
  estimatedTokens: number;
  /** 上下文窗口 token */
  windowTokens: number;
  /** 本轮是否触发了压缩 */
  compactionTriggered: boolean;
  breakdown: ContextBreakdown;
  /** 降级说明（fallback 触发原因；正常为 null） */
  degradedReason?: string;
}

// ============================================================================
// 自愈（healer）
// ============================================================================

export interface HealLogEntry {
  kind: 'args-repair' | 'tool-name' | 'schema-fix';
  detail: string;
}

export interface HealResult {
  /** 修复后的工具名（可能被模糊纠正） */
  toolName: string;
  /** 修复后的参数 */
  args: unknown;
  /** 修复日志（空 = 无需修复；非空时合并进 tool result 供模型感知） */
  healLog: HealLogEntry[];
  /** 是否可执行（false = 修复失败，用 errorText 回传让模型自纠） */
  executable: boolean;
  /** executable=false 时可直接作为 tool result 的结构化错误文本 */
  errorText?: string;
  /** 候选工具名（纠正失败时供错误信息使用） */
  candidates?: string[];
}

// ============================================================================
// 统计与遥测
// ============================================================================

export interface CacheHitSample {
  at: string;
  promptTokens: number;
  cachedTokens: number;
  /** cached/prompt 比率（prompt=0 时为 0） */
  hitRate: number;
}

/** 系统上下文构成（前端「系统」标签页折叠栏数据源） */
export interface SystemSection {
  /** 'identity' | 'rules' | 'spec-guide' | 'skill' | 'env' | 'summary' */
  id: string;
  title: string;
  tokens: number;
  content: string;
  defaultOpen?: boolean;
}

export interface ContextStats {
  sessionId: string;
  breakdown: ContextBreakdown;
  windowTokens: number;
  /** 本轮发送估算 token 占窗口百分比 */
  usedPercent: number;
  compaction: {
    enabled: boolean;
    compactRatio: number;
    /** 已压缩消息条数 */
    compactedMessages: number;
    /** 活跃摘要 token */
    activeSummaryTokens: number;
    lastCompaction?: CompactionRecord;
  };
  cacheHits: CacheHitSample[];
  /** 近样本平均命中率（无样本为 null） */
  avgHitRate: number | null;
  systemSections: SystemSection[];
}

/** 遥测环形缓冲容量（每 session 保留最近样本数） */
export const TELEMETRY_BUFFER_SIZE = 50;

// ============================================================================
// WS 事件 payload（api/events 推送）
// context-stats-updated 的 payload 直接使用完整 ContextStats（见 getStats）
// ============================================================================

export interface CompactionEventPayload {
  sessionId: string;
  compaction: CompactionRecord;
}

export interface CompactionStartedEventPayload {
  sessionId: string;
  trigger: 'auto' | 'manual';
}

export interface HealedEventPayload {
  sessionId: string;
  toolCallId: string;
  healLog: HealLogEntry[];
}

export interface ContextDegradedEventPayload {
  sessionId: string;
  reason: string;
}

// ============================================================================
// 手动压缩结果
// ============================================================================

export interface ManualCompactResult {
  ok: boolean;
  /** ok=false 的原因（会话不存在/运行中/区太小/摘要失败） */
  reason?: string;
  compaction?: CompactionRecord;
}

/** 手动压缩预览（确认对话框数据源） */
export interface CompactPreview {
  sessionId: string;
  /** 将被压缩的消息条数 */
  compactableCount: number;
  /** 可压缩区估算 token */
  compactableTokens: number;
  /** 尾部将保留的消息条数 */
  tailKeepCount: number;
  /** 预计压缩后总 token（摘要按 summaryMaxTokens 上限估） */
  estimatedAfterTokens: number;
}
