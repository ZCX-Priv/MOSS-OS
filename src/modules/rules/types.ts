// src/modules/rules/types.ts
// 规则引擎类型契约：用户自定义行为规则（哈希 JSON 存储，always/paths 双加载模式）。
// 作用域：全局 ~/.moss/rules/ + 项目级 {cwd}/.moss/rules/（项目级同名优先）。

/** 规则加载模式（由 paths 字段推导） */
export type RuleLoadMode = 'always' | 'paths';

/** 单条规则记录（一个 JSON 文件，文件名 = 内容哈希） */
export interface RuleRecord {
  /** 内容哈希（sha256 前 16 位 hex）；编辑内容即换新文件 */
  id: string;
  /** 规则名（同名去重键：项目级覆盖全局） */
  name: string;
  /** 一句话描述（管理界面展示） */
  description: string;
  /** 规则正文（Markdown） */
  content: string;
  /** glob 模式列表；空数组 = always 规则（始终注入系统提示） */
  paths: string[];
  /** 启用状态 */
  enabled: boolean;
  /** 同名冲突优先级（高者胜；项目级默认高于全局） */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/** 规则作用域 */
export type RuleScope = 'global' | 'project';

/** 带作用域标注的规则（列表接口返回） */
export interface ScopedRuleRecord extends RuleRecord {
  scope: RuleScope;
}

/** 编译后的规则集合（注入用） */
export interface CompiledRuleSet {
  /** always 规则（注入静态系统提示） */
  alwaysRules: ScopedRuleRecord[];
  /** paths 规则（读写匹配文件时注入会话锚定消息） */
  pathRules: ScopedRuleRecord[];
  /** 集合内容指纹（缓存键；规则集变更即失效） */
  fingerprint: string;
}

/** 规则写入输入（id 由内容哈希推导，调用方不传） */
export interface RuleUpsertInput {
  name: string;
  description?: string;
  content: string;
  paths?: string[];
  enabled?: boolean;
  priority?: number;
}
